// Package owneruid owns public owner numbers, independently of Agent IDs.
package owneruid

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

var ErrClosed = errors.New("public UID batch is paused or exhausted")

type Batch struct {
	Name   string `json:"name"`
	Digits int    `json:"digits"`
	Quota  int64  `json:"quota"`
	Issued int64  `json:"issued"`
	Active bool   `json:"active"`
}

func Valid(number int64) bool { return number >= 10000 && number <= 99999999999 }

// All callers hold this short transaction lock, including operator commands.
// Password hashing and external requests must happen outside this transaction.
func lock(tx *gorm.DB) error {
	return tx.Exec(`SELECT pg_advisory_xact_lock(734817611)`).Error
}

// Allocate is called inside the same transaction as phone proof consumption,
// account creation and Agent ownership. A failed registration consumes nothing.
func Allocate(tx *gorm.DB, agentID, now int64) (int64, error) {
	if err := lock(tx); err != nil {
		return 0, err
	}
	var number int64
	if err := tx.Raw(`SELECT number FROM owner_uid_numbers WHERE reserved_agent_id=? AND owner_uid IS NULL`, agentID).Scan(&number).Error; err != nil {
		return 0, err
	}
	if number != 0 {
		return number, tx.Exec(`UPDATE owner_uid_numbers SET owner_uid=? WHERE number=?`, strconv.FormatInt(number, 10), number).Error
	}
	var batch Batch
	if err := tx.Raw(`SELECT * FROM owner_uid_batches WHERE active`).Scan(&batch).Error; err != nil {
		return 0, err
	}
	if batch.Name == "" || batch.Issued >= batch.Quota {
		return 0, ErrClosed
	}
	low := int64(1)
	for i := 1; i < batch.Digits; i++ {
		low *= 10
	}
	high := low*10 - 1
	for attempt := 0; attempt < 64; attempt++ {
		draw, err := rand.Int(rand.Reader, big.NewInt(high-low+1))
		if err != nil {
			return 0, err
		}
		number = low + draw.Int64()
		// If reservations densely occupy the range, find a gap after a random
		// start, wrapping once. Work is proportional to allocated numbers only.
		if attempt == 63 {
			result := tx.Raw(`SELECT candidate FROM (
                SELECT ?::bigint AS candidate UNION SELECT ?::bigint
                UNION SELECT number+1 FROM owner_uid_numbers WHERE number BETWEEN ? AND ?
            ) candidates WHERE candidate BETWEEN ? AND ?
            AND NOT EXISTS(SELECT 1 FROM owner_uid_numbers WHERE number=candidate)
            ORDER BY CASE WHEN candidate >= ? THEN 0 ELSE 1 END,candidate LIMIT 1`, number, low, low, high, low, high, number).Scan(&number)
			if result.Error != nil {
				return 0, result.Error
			}
			if result.RowsAffected == 0 {
				return 0, ErrClosed
			}
		}
		result := tx.Exec(`INSERT INTO owner_uid_numbers(number,source,batch_name,owner_uid,created_at)
            VALUES(?,'public',?,?,?) ON CONFLICT(number) DO NOTHING`, number, batch.Name, strconv.FormatInt(number, 10), now)
		if result.Error != nil {
			return 0, result.Error
		}
		if result.RowsAffected == 1 {
			return number, tx.Exec(`UPDATE owner_uid_batches SET issued=issued+1 WHERE name=?`, batch.Name).Error
		}
	}
	return 0, ErrClosed
}

// Admin commands are only exposed by a server-side binary with direct DB access.
// There is deliberately no public API accepting a requested UID or batch switch.
type Command struct {
	Action  string `json:"action"`
	Name    string `json:"name,omitempty"`
	Digits  int    `json:"digits,omitempty"`
	Quota   int64  `json:"quota,omitempty"`
	Number  int64  `json:"number,omitempty"`
	AgentID int64  `json:"agent_id,omitempty"`
	Actor   string `json:"-"`
	Reason  string `json:"-"`
}

func Admin(db *gorm.DB, cmd Command) error {
	if strings.TrimSpace(cmd.Actor) == "" || strings.TrimSpace(cmd.Reason) == "" {
		return errors.New("actor and reason are required")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := lock(tx); err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		switch cmd.Action {
		case "open":
			if cmd.Name == "" || cmd.Digits < 5 || cmd.Digits > 11 || cmd.Quota <= 0 {
				return errors.New("provide a new batch name, 5-11 digits and a positive quota")
			}
			if err := tx.Exec(`UPDATE owner_uid_batches SET active=false WHERE active`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO owner_uid_batches(name,digits,quota,active) VALUES(?,?,?,true)`, cmd.Name, cmd.Digits, cmd.Quota).Error; err != nil {
				return err
			}
		case "pause":
			if err := tx.Exec(`UPDATE owner_uid_batches SET active=false WHERE active`).Error; err != nil {
				return err
			}
		case "resume":
			if err := tx.Exec(`UPDATE owner_uid_batches SET active=false WHERE active`).Error; err != nil {
				return err
			}
			result := tx.Exec(`UPDATE owner_uid_batches SET active=true WHERE name=? AND issued<quota`, cmd.Name)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("batch missing or exhausted")
			}
		case "reserve", "assign":
			if !Valid(cmd.Number) {
				return errors.New("UID must be 5-11 digits without a leading zero")
			}
			if cmd.Action == "reserve" {
				if err := tx.Exec(`INSERT INTO owner_uid_numbers(number,source,created_at) VALUES(?,'operator',?)`, cmd.Number, now).Error; err != nil {
					return err
				}
			} else {
				var exists bool
				if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM agents a WHERE a.agent_id=? AND a.identity_state='active'
                    AND NOT EXISTS(SELECT 1 FROM agent_owners o WHERE o.agent_id=a.agent_id)
                    AND NOT EXISTS(SELECT 1 FROM agent_email_bindings e WHERE e.agent_id=a.agent_id AND e.status='active'))`, cmd.AgentID).Scan(&exists).Error; err != nil {
					return err
				}
				if !exists {
					return errors.New("assignment requires an active unowned Agent")
				}
				// Reserve-and-assign or attach a previously unassigned reservation.
				result := tx.Exec(`INSERT INTO owner_uid_numbers(number,source,reserved_agent_id,created_at) VALUES(?,'operator',?,?)
                    ON CONFLICT(number) DO UPDATE SET reserved_agent_id=excluded.reserved_agent_id
                    WHERE owner_uid_numbers.source='operator' AND owner_uid_numbers.owner_uid IS NULL AND owner_uid_numbers.reserved_agent_id IS NULL`, cmd.Number, cmd.AgentID, now)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return errors.New("UID is already reserved for an Agent or issued")
				}
			}
		default:
			return errors.New("unknown command")
		}
		detail, err := json.Marshal(cmd)
		if err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO owner_uid_admin_events(action,detail,actor,reason,created_at) VALUES(?,?::jsonb,?,?,?)`, cmd.Action, string(detail), cmd.Actor, cmd.Reason, now).Error
	})
}
