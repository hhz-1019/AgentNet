package consolev2

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"time"

	"gorm.io/gorm"
)

//go:embed managed_avatars/*.png
var managedPublicAvatars embed.FS

// Only newly provisioned characters receive defaults. Existing user and
// operator choices remain untouched; assets use the same avatar serving path.
func seedNewCelebrityAvatars(tx *gorm.DB, owner string, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	var rows []struct {
		AgentID   int64
		SourceKey string
	}
	if e := tx.Raw(`SELECT agent_id,source_key FROM managed_public_sources WHERE sponsor_uid=? AND agent_id IN ? AND kind='celebrity'`, owner, ids).Scan(&rows).Error; e != nil {
		return e
	}
	for _, row := range rows {
		body, e := managedPublicAvatars.ReadFile("managed_avatars/" + row.SourceKey + ".png")
		if e != nil {
			continue
		}
		id := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("public-avatar:%d:%s", row.AgentID, row.SourceKey))))[:32]
		if e = tx.Exec(`INSERT INTO agent_avatars(avatar_id,agent_id,content,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`, id, row.AgentID, body, time.Now().UnixMilli()).Error; e != nil {
			return e
		}
		if e = tx.Exec(`UPDATE twin_users t SET portrait_fields=jsonb_set(t.portrait_fields,'{avatar}',to_jsonb(?::text)),portrait_revision=portrait_revision+1,portrait_last_write_hash=''
		 FROM agent_owners o WHERE o.agent_id=? AND o.owner_uid=t.user_id AND COALESCE(t.portrait_fields->>'avatar','')=''`, "/api/v2/public/avatars/"+id, row.AgentID).Error; e != nil {
			return e
		}
	}
	return nil
}
