package consolev2

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Retire in place: seed indexes, names, posts and relationships remain stable.
// Called only by the operator's existing seed/reconcile action, never on reads.
func retireCelebrityMembers(tx *gorm.DB, owner string) error {
	if err := tx.Exec("SELECT sponsor_uid FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE", owner).Error; err != nil {
		return err
	}
	for _, p := range celebrityCatalog() {
		if !p.Retired {
			continue
		}
		if err := tx.Exec(`UPDATE managed_members m SET enabled=false,revision=revision+1,
		 pending_topic='',pending_action='',pending_recipient_id=NULL,pending_task_id='',pending_task_digest=''
		 FROM managed_public_sources p WHERE p.agent_id=m.agent_id AND p.sponsor_uid=?
		 AND p.source_key=? AND p.kind='celebrity' AND m.sponsor_uid=p.sponsor_uid
		 AND m.deleted_at=0 AND m.enabled`, owner, p.Key).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE managed_public_sources SET enabled=false WHERE sponsor_uid=? AND source_key=? AND kind='celebrity'`, owner, p.Key).Error; err != nil {
			return err
		}
	}
	return nil
}

func publicEventKey(item managedSource) string {
	u, err := url.Parse(item.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || item.Title == "" {
		return ""
	}
	u.Fragment = ""
	query := u.Query()
	for key := range query {
		if strings.HasPrefix(strings.ToLower(key), "utm_") {
			query.Del(key)
		}
	}
	u.RawQuery = query.Encode()
	// Updates to an existing original can matter; a changed scrape timestamp cannot.
	return fmt.Sprintf("%x", sha256.Sum256([]byte(u.String()+"\n"+strings.Join(strings.Fields(item.Title+"\n"+item.Summary), " "))))
}

// A new source observation wakes the same managed activity runtime. It does not
// choose a post, bypass budgets/quiet hours, or replace a pending human task.
// The caller holds campaign/source locks and commits the snapshot atomically.
func recordPublicEvents(tx *gorm.DB, owner, key string, agent int64, items []managedSource, baseline bool, now time.Time) error {
	changed := false
	for _, item := range items {
		fingerprint := publicEventKey(item)
		stamp, err := time.Parse(time.RFC3339, item.Published)
		if fingerprint == "" || err != nil {
			continue
		}
		r := tx.Exec(`INSERT INTO managed_public_events(sponsor_uid,source_key,fingerprint,observed_at)
		 VALUES(?,?,?,?) ON CONFLICT DO NOTHING`, owner, key, fingerprint, now.UnixMilli())
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected > 0 && !baseline && !stamp.Before(now.Add(-48*time.Hour)) && !stamp.After(now) {
			changed = true
		}
	}
	if !changed {
		return nil
	}
	// A small stable spread avoids a source-poll batch becoming a publishing wave.
	next := now.Add(time.Duration(agent%91) * time.Second).UnixMilli()
	r := tx.Exec(`UPDATE managed_members m SET next_run_at=LEAST(m.next_run_at,?)
	 FROM managed_public_sources p,managed_campaigns c
	 WHERE m.agent_id=? AND m.sponsor_uid=? AND m.enabled AND m.deleted_at=0
	 AND p.agent_id=m.agent_id AND p.sponsor_uid=m.sponsor_uid AND p.source_key=? AND p.enabled
	 AND c.sponsor_uid=m.sponsor_uid AND c.enabled
	 AND m.pending_action='' AND m.pending_task_id='' AND m.pending_topic=''
	 AND m.next_run_at>?`, next, agent, owner, key, next)
	if r.Error != nil {
		return r.Error
	}
	if r.RowsAffected > 0 {
		return managedAudit(tx, owner, "public_event_wake", agent)
	}
	return nil
}
