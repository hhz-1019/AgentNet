package consolev2

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/lib/pq"
	"gorm.io/gorm"
)

// References without foreign keys in the upstream schema are seeded explicitly.
// FK descendants are then included, except SET NULL/DEFAULT edges. Metadata is
// read from PostgreSQL, never from a client-supplied table or column name.
var erasureAgentColumns = map[string]bool{
	"consumed_by_agent_id": true, "agent_id": true, "author_agent_id": true, "subject_agent_id": true,
	"source_agent_id": true, "target_agent_id": true, "actor_agent_id": true,
	"sender_id": true, "receiver_id": true, "from_uid": true, "to_uid": true,
	"follower_id": true, "followed_id": true, "participant_a": true, "participant_b": true,
}

type erasureTable struct {
	Name string
	OID  int64 `gorm:"column:oid"`
}

type erasureColumn struct{ TableName, ColumnName string }
type erasureEdge struct {
	Child, Parent, Condition, DeleteType string
	ChildOID                             int64 `gorm:"column:child_oid"`
	ParentOID                            int64 `gorm:"column:parent_oid"`
}

func eraseAccountRows(tx *gorm.DB, a uidAccount, ids, items []int64) error {
	if err := tx.Exec(`SET LOCAL lock_timeout='3s'`).Error; err != nil {
		return err
	}
	if err := tx.Exec(`CREATE TEMP TABLE erasure_rows(relid OID,row_tid TID,PRIMARY KEY(relid,row_tid)) ON COMMIT DROP`).Error; err != nil {
		return err
	}
	var columns []erasureColumn
	if err := tx.Raw(`SELECT c.table_name,c.column_name FROM information_schema.columns c
 JOIN information_schema.tables t USING(table_catalog,table_schema,table_name)
 WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
 AND c.table_name NOT IN ('account_erasure_jobs','erased_agent_ids','erased_item_ids','erased_owner_ids','owner_uid_numbers')
 ORDER BY c.table_name,c.ordinal_position`).Scan(&columns).Error; err != nil {
		return err
	}
	predicates := map[string][]string{}
	for _, c := range columns {
		col := pq.QuoteIdentifier(c.ColumnName)
		switch {
		case erasureAgentColumns[c.ColumnName]:
			predicates[c.TableName] = append(predicates[c.TableName], col+"::text = ANY(@agents)")
		case c.ColumnName == "owner_uid" || c.ColumnName == "user_id" || c.ColumnName == "sponsor_uid" || (c.TableName == "human_accounts" && c.ColumnName == "uid"):
			predicates[c.TableName] = append(predicates[c.TableName], col+" = @owner")
		case c.ColumnName == "item_id":
			predicates[c.TableName] = append(predicates[c.TableName], col+"::text = ANY(@items)")
		case c.TableName == "human_phone_challenges" && c.ColumnName == "phone_hash":
			predicates[c.TableName] = append(predicates[c.TableName], "phone_hash IN (SELECT phone_hash FROM human_accounts WHERE uid=@owner)")
		case (c.TableName == "auth_email_challenges" || c.TableName == "console_v2_email_conflicts") && (c.ColumnName == "email" || c.ColumnName == "normalized_email"):
			predicates[c.TableName] = append(predicates[c.TableName], col+" IN (SELECT email FROM agents WHERE agent_id::text=ANY(@agents))")
		}
	}
	names := make([]string, 0, len(predicates))
	for name := range predicates {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		q := fmt.Sprintf(`INSERT INTO erasure_rows SELECT tableoid,ctid FROM public.%s WHERE %s ON CONFLICT DO NOTHING`, pq.QuoteIdentifier(name), strings.Join(predicates[name], " OR "))
		if err := tx.Exec(q, sql.Named("owner", a.UID), sql.Named("agents", pq.Array(decimalIDs(ids))), sql.Named("items", pq.Array(decimalIDs(items)))).Error; err != nil {
			return fmt.Errorf("seed %s: %w", name, err)
		}
	}
	var edges []erasureEdge
	if err := tx.Raw(`SELECT c.confdeltype::text AS delete_type,c.conrelid::bigint AS child_oid,c.confrelid::bigint AS parent_oid,
 c.conrelid::regclass::text AS child,c.confrelid::regclass::text AS parent,
 string_agg(format('child.%I = parent.%I',ca.attname,pa.attname),' AND ' ORDER BY k.ord) AS condition
 FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
 CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS k(childatt,parentatt,ord)
 JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.childatt
 JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parentatt
 WHERE c.contype='f' AND ns.nspname='public'
 GROUP BY c.oid ORDER BY c.conrelid`).Scan(&edges).Error; err != nil {
		return err
	}
	for round := 0; round < 64; round++ {
		var added int64
		for _, edge := range edges {
			if edge.DeleteType == "n" || edge.DeleteType == "d" {
				continue
			}
			// regclass names are generated and quoted by PostgreSQL itself.
			q := fmt.Sprintf(`INSERT INTO erasure_rows SELECT child.tableoid,child.ctid FROM %s child JOIN %s parent ON %s
    JOIN erasure_rows r ON r.relid=parent.tableoid AND r.row_tid=parent.ctid ON CONFLICT DO NOTHING`, edge.Child, edge.Parent, edge.Condition)
			result := tx.Exec(q)
			if result.Error != nil {
				return result.Error
			}
			added += result.RowsAffected
		}
		var count int64
		if err := tx.Raw(`SELECT count(*) FROM erasure_rows`).Scan(&count).Error; err != nil {
			return err
		}
		if count > 100000 {
			return errErasureBlocked
		}
		if added == 0 {
			break
		}
		if round == 63 {
			return errors.New("erasure dependency depth exceeded")
		}
	}
	// Fail closed if future schema changes would pull another identity into scope.
	var unsafe bool
	if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM agents a JOIN erasure_rows r ON r.relid=a.tableoid AND r.row_tid=a.ctid WHERE NOT(a.agent_id=ANY(?)))
 OR EXISTS(SELECT 1 FROM human_accounts a JOIN erasure_rows r ON r.relid=a.tableoid AND r.row_tid=a.ctid WHERE a.uid<>?)`, pq.Array(nonNilIDs(ids)), a.UID).Scan(&unsafe).Error; err != nil {
		return err
	}
	if unsafe {
		return errErasureBlocked
	}
	var tables []erasureTable
	if err := tx.Raw(`SELECT DISTINCT relid::regclass::text AS name,relid::bigint AS oid FROM erasure_rows ORDER BY oid DESC`).Scan(&tables).Error; err != nil {
		return err
	}
	for _, table := range tables {
		// Keep ctid selections stable until commit. A concurrent replacement fails
		// closed on FK validation rather than escaping the deletion transaction.
		if err := tx.Exec(fmt.Sprintf(`SELECT t.ctid FROM %s t JOIN erasure_rows r ON r.relid=t.tableoid AND r.row_tid=t.ctid FOR UPDATE OF t`, table.Name)).Error; err != nil {
			return err
		}
	}
	// Retain only the public-number reservation; do not recycle an issued number.
	if err := tx.Exec(`UPDATE owner_uid_numbers SET owner_uid='deleted:'||number::text,reserved_agent_id=NULL WHERE owner_uid=? OR reserved_agent_id=ANY(?)`, a.UID, pq.Array(nonNilIDs(ids))).Error; err != nil {
		return err
	}
	remaining := tables
	for round := 0; len(remaining) > 0 && round < 64; round++ {
		next := make([]erasureTable, 0, len(remaining))
		progress := false
		for _, table := range remaining {
			waiting := false
			for _, edge := range edges {
				if edge.ParentOID == table.OID && edge.ChildOID != table.OID {
					for _, child := range remaining {
						if child.OID == edge.ChildOID {
							waiting = true
						}
					}
				}
			}
			if waiting {
				next = append(next, table)
				continue
			}
			if err := tx.Exec(`SAVEPOINT erase_table`).Error; err != nil {
				return err
			}
			result := tx.Exec(fmt.Sprintf(`DELETE FROM %s t USING erasure_rows r WHERE r.relid=t.tableoid AND r.row_tid=t.ctid`, table.Name))
			if result.Error != nil {
				if err := tx.Exec(`ROLLBACK TO SAVEPOINT erase_table`).Error; err != nil {
					return err
				}
				var pg interface{ SQLState() string }
				if !errors.As(result.Error, &pg) || pg.SQLState() != "23503" {
					return fmt.Errorf("erase %s: %w", table.Name, result.Error)
				}
				next = append(next, table)
			} else {
				progress = true
			}
			if err := tx.Exec(`RELEASE SAVEPOINT erase_table`).Error; err != nil {
				return err
			}
		}
		if !progress {
			return errors.New("unresolved erasure dependencies")
		}
		remaining = next
	}
	if len(remaining) > 0 {
		return errors.New("erasure incomplete")
	}
	var count int64
	if err := tx.Raw(`SELECT count(*) FROM human_accounts WHERE uid=?`, a.UID).Scan(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return errors.New("account remains")
	}
	return nil
}
