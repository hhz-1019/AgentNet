package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

var errPortraitConflict = errors.New("portrait revision conflict")
var portraitKeys = map[string]int{"name": 80, "bio": 1000, "interests": 1000, "role": 200, "values": 1000, "recent": 1000}

// Optional initial Agent prefill inside the existing onboarding twin_profile envelope.
type portraitDraft struct {
	Fields   map[string]string `json:"fields"`
	Memories []portraitMemory  `json:"memories"`
}

func validatePortraitDraft(p portraitDraft) error {
	for k, v := range p.Fields {
		limit, ok := portraitKeys[k]
		if !ok || utf8.RuneCountInString(v) > limit {
			return errors.New("画像字段无效或过长")
		}
	}
	if len(p.Memories) > 100 {
		return errors.New("初始记忆每批最多 100 条；接入后可以继续增量同步")
	}
	ids := map[string]bool{}
	for _, m := range p.Memories {
		if !twinUUID.MatchString(m.ID) || ids[m.ID] || strings.TrimSpace(m.Content) == "" || utf8.RuneCountInString(m.Content) > 16000 {
			return errors.New("记忆格式无效")
		}
		ids[m.ID] = true
	}
	return nil
}

type portraitMemory struct {
	ID         string `json:"id" gorm:"column:memory_id"`
	Content    string `json:"content"`
	ShowOnHome bool   `json:"showOnHome"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	Source     string `json:"source" gorm:"-"`
}
type portraitRow struct {
	LastWriteHash string
	Fields        string
	Visible       string
	Revision      int64
	HumanFields   string
}

func (s *Service) registerElsewhereRoutes(h *server.Hertz) {
	h.GET("/api/v2/console/portrait", s.consoleAuth(false), s.getPortrait)
	h.PUT("/api/v2/console/portrait", s.consoleAuth(true), s.putPortrait)
	h.POST("/api/v2/console/portrait/confirm", s.consoleAuth(true), s.confirmPortrait)
	h.GET("/api/v2/agent-context/portrait", s.agentAuth("context:read"), s.requireCompleted, s.getPortrait)
	h.PUT("/api/v2/agent-context/portrait", s.agentAuth("context:write"), s.requireCompleted, s.putPortrait)
	h.GET("/api/v2/console/people/:person_id", s.consoleAuth(false), s.requireCompleted, s.getPerson)
	h.PUT("/api/v2/console/people/:person_id/follow", s.consoleAuth(true), s.requireCompleted, s.putFollow)
	s.registerElsewhereCommunication(h)
	h.POST("/api/v2/console/social/share", s.consoleAuth(true), s.requireCompleted, s.shareSocialPost)
	h.POST("/api/v2/console/social/upload", s.consoleAuth(true), s.requireCompleted, s.uploadSocialAttachment)
}
func readPortraitRow(db *gorm.DB, owner string, lock bool) (portraitRow, error) {
	var r portraitRow
	q := `SELECT portrait_last_write_hash AS last_write_hash,portrait_fields::text AS fields,portrait_visible::text AS visible,portrait_revision AS revision,portrait_human_fields::text AS human_fields FROM twin_users WHERE user_id=?`
	if lock {
		q += " FOR UPDATE"
	}
	e := db.Raw(q, owner).Scan(&r).Error
	return r, e
}
func (s *Service) getPortrait(ctx context.Context, c *app.RequestContext) {
	owner, _, ok := s.twinOwner(c)
	if !ok {
		return
	}
	if e := ensureTwinUser(s.db.WithContext(ctx), owner, time.Now().UnixMilli()); e != nil {
		s.socialFailure(c, e)
		return
	}
	r, e := readPortraitRow(s.db.WithContext(ctx), owner, false)
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	var fields map[string]string
	_ = json.Unmarshal([]byte(r.Fields), &fields)
	if fields == nil {
		fields = map[string]string{}
	}
	for k := range portraitKeys {
		if _, ok := fields[k]; !ok {
			fields[k] = ""
		}
	}
	memories, next, e := readPortraitMemories(s.db.WithContext(ctx), owner, c.Query("cursor"), c.Query("q"), false)
	if e != nil {
		fail(c, 400, "INVALID_QUERY", "记忆查询失败，请检查分页参数", nil)
		return
	}
	var total int64
	if e = s.db.Raw(`SELECT count(*) FROM portrait_memories WHERE user_id=? AND NOT deleted AND strpos(lower(content),lower(?))>0`, owner, c.Query("q")).Scan(&total).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	reply(c, 200, map[string]any{"fields": fields, "visible": json.RawMessage(r.Visible), "revision": r.Revision, "memories": memories, "next_cursor": next, "total": total})
}
func readPortraitMemories(db *gorm.DB, owner, cursor, query string, public bool) ([]portraitMemory, string, error) {
	rows := []portraitMemory{}
	offset := 0
	if cursor != "" {
		var e error
		offset, e = strconv.Atoi(cursor)
		if e != nil || offset < 0 {
			return rows, "", errors.New("invalid cursor")
		}
	}
	if utf8.RuneCountInString(query) > 100 {
		return rows, "", errors.New("invalid query")
	}
	q := `SELECT memory_id,content,show_on_home,created_at,updated_at FROM portrait_memories WHERE user_id=? AND NOT deleted AND strpos(lower(content),lower(?))>0`
	if public {
		q += " AND show_on_home"
	}
	e := db.Raw(q+` ORDER BY created_at DESC,memory_id DESC LIMIT 13 OFFSET ?`, owner, query, offset).Scan(&rows).Error
	next := ""
	if len(rows) > 12 {
		rows = rows[:12]
		next = strconv.Itoa(offset + 12)
	}
	for i := range rows {
		rows[i].Source = "self"
	}
	return rows, next, e
}
func (s *Service) putPortrait(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		ExpectedRevision int64             `json:"expected_revision"`
		Fields           map[string]string `json:"fields"`
		Visible          *[]string         `json:"visible"`
		Upserts          []portraitMemory  `json:"upserts"`
		Deletes          []string          `json:"deletes"`
	}
	if decodeBody(c, &req) != nil || req.ExpectedRevision < 0 || len(req.Upserts) > 100 || len(req.Deletes) > 100 {
		fail(c, 400, "INVALID_PORTRAIT", "资料格式无效，每次最多同步 100 条记忆", nil)
		return
	}
	human := strings.HasPrefix(string(c.Path()), "/api/v2/console/")
	if !human && req.Visible != nil {
		fail(c, 403, "HUMAN_VISIBILITY_REQUIRED", "主页可见范围由本人设置", nil)
		return
	}
	for k, v := range req.Fields {
		limit, ok := portraitKeys[k]
		if !ok || utf8.RuneCountInString(v) > limit || (k == "name" && strings.TrimSpace(v) == "") {
			fail(c, 400, "INVALID_PORTRAIT", "昵称必填，资料请遵守长度限制", nil)
			return
		}
	}
	if req.Visible != nil {
		seen := map[string]bool{}
		for _, k := range *req.Visible {
			if _, ok := portraitKeys[k]; !ok || seen[k] {
				fail(c, 400, "INVALID_PORTRAIT", "可见字段无效", nil)
				return
			}
			seen[k] = true
		}
		if !seen["name"] {
			*req.Visible = append(*req.Visible, "name")
		}
	}
	seen := map[string]bool{}
	for _, m := range req.Upserts {
		if !twinUUID.MatchString(m.ID) || seen[m.ID] || strings.TrimSpace(m.Content) == "" || utf8.RuneCountInString(m.Content) > 16000 || (!human && m.ShowOnHome) {
			fail(c, 400, "INVALID_MEMORY", "记忆内容或可见范围无效", nil)
			return
		}
		seen[m.ID] = true
	}
	for _, id := range req.Deletes {
		if !twinUUID.MatchString(id) || seen[id] {
			fail(c, 400, "INVALID_MEMORY", "记忆编号无效或重复", nil)
			return
		}
		seen[id] = true
	}
	for i := range req.Upserts {
		req.Upserts[i].CreatedAt = 0
		req.Upserts[i].UpdatedAt = 0
		req.Upserts[i].Source = ""
	}
	payload, _ := json.Marshal(req)
	writeHash := fmt.Sprintf("%t:%x", human, sha256.Sum256(payload))
	now := time.Now().UnixMilli()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := ensureTwinUser(tx, owner, now); e != nil {
			return e
		}
		r, e := readPortraitRow(tx, owner, true)
		if e != nil {
			return e
		}
		if r.Revision != req.ExpectedRevision {
			if r.Revision == req.ExpectedRevision+1 && r.LastWriteHash == writeHash {
				return nil
			}
			return errPortraitConflict
		}
		fields := map[string]string{}
		_ = json.Unmarshal([]byte(r.Fields), &fields)
		locked := []string{}
		_ = json.Unmarshal([]byte(r.HumanFields), &locked)
		for k, v := range req.Fields {
			protected := false
			for _, h := range locked {
				if h == k {
					protected = true
				}
			}
			if !human && protected && fields[k] != v {
				return errPortraitConflict
			}
			fields[k] = v
			if human && !protected {
				locked = append(locked, k)
			}
		}
		visible := []string{}
		_ = json.Unmarshal([]byte(r.Visible), &visible)
		if req.Visible != nil {
			visible = *req.Visible
		}
		actor := "agent"
		if human {
			actor = "human"
		}
		for _, m := range req.Upserts {
			if !human {
				var protected bool
				if e := tx.Raw(`SELECT EXISTS(SELECT 1 FROM portrait_memories WHERE user_id=? AND memory_id=? AND edited_by='human')`, owner, m.ID).Scan(&protected).Error; e != nil {
					return e
				}
				if protected {
					return errPortraitConflict
				}
			}
			if e := tx.Exec(`INSERT INTO portrait_memories(user_id,memory_id,content,show_on_home,edited_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,memory_id) DO UPDATE SET content=EXCLUDED.content,show_on_home=EXCLUDED.show_on_home,edited_by=EXCLUDED.edited_by,updated_at=EXCLUDED.updated_at,deleted=false`, owner, m.ID, strings.TrimSpace(m.Content), m.ShowOnHome, actor, now, now).Error; e != nil {
				return e
			}
		}
		for _, mid := range req.Deletes {
			if !human {
				return errPortraitConflict
			}
			if e := tx.Exec(`UPDATE portrait_memories SET deleted=true,edited_by='human',updated_at=? WHERE user_id=? AND memory_id=?`, now, owner, mid).Error; e != nil {
				return e
			}
		}
		f, _ := json.Marshal(fields)
		v, _ := json.Marshal(visible)
		l, _ := json.Marshal(locked)
		if e := tx.Exec(`UPDATE twin_users SET portrait_fields=?::jsonb,portrait_visible=?::jsonb,portrait_human_fields=?::jsonb,portrait_revision=portrait_revision+1,portrait_last_write_hash=?,name=?,last_active_at=? WHERE user_id=?`, string(f), string(v), string(l), writeHash, fields["name"], now, owner).Error; e != nil {
			return e
		}
		if interests, changed := req.Fields["interests"]; changed {
			tags := []string{}
			seen := map[string]bool{}
			for _, tag := range strings.FieldsFunc(interests, func(r rune) bool { return strings.ContainsRune(",，、;；\n", r) }) {
				tag = strings.TrimSpace(tag)
				if tag != "" && utf8.RuneCountInString(tag) <= 30 && !seen[tag] && len(tags) < 8 {
					tags = append(tags, tag)
					seen[tag] = true
				}
			}
			raw, _ := json.Marshal(tags)
			if e := tx.Exec("INSERT INTO social_preferences(agent_id,tags,revision) VALUES(?,?::jsonb,1) ON CONFLICT(agent_id) DO UPDATE SET tags=EXCLUDED.tags,revision=social_preferences.revision+1", id, string(raw)).Error; e != nil {
				return e
			}
		}
		// Only explicitly public profile text reaches the legacy public Agent card.
		bio := ""
		for _, k := range visible {
			if k == "bio" {
				bio = fields["bio"]
			}
		}
		if fields["name"] != "" {
			return tx.Exec(`UPDATE agents SET agent_name=?,bio=? WHERE agent_id=?`, fields["name"], bio, id).Error
		}
		return nil
	})
	if errors.Is(err, errPortraitConflict) {
		fail(c, 409, "REVISION_CONFLICT", "资料已变更，或包含本人保护的内容；请读取最新版本后核对", nil)
		return
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"revision": req.ExpectedRevision + 1})
}
func (s *Service) getPerson(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialDecimal(c.Param("person_id"))
	var p struct {
		AgentID    int64
		AgentName  string
		Bio        string
		IsOfficial bool
		OwnerUID   string
	}
	e := s.db.WithContext(ctx).Raw(`SELECT a.agent_id,a.agent_name,a.bio,a.is_official,COALESCE(o.owner_uid,'') AS owner_uid FROM agents a LEFT JOIN agent_owners o USING(agent_id) WHERE a.agent_id=? AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=a.agent_id) OR (b.to_uid=? AND b.from_uid=a.agent_id)))`, id, viewer, viewer).Scan(&p).Error
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	if p.AgentID == 0 {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	fields := map[string]string{"name": p.AgentName, "bio": p.Bio}
	visible := []string{"name", "bio"}
	memories := []portraitMemory{}
	next := ""
	if p.OwnerUID != "" {
		r, e := readPortraitRow(s.db.WithContext(ctx), p.OwnerUID, false)
		if e != nil {
			s.socialFailure(c, e)
			return
		}
		if r.Fields != "" && r.Fields != "{}" {
			raw := map[string]string{}
			_ = json.Unmarshal([]byte(r.Fields), &raw)
			_ = json.Unmarshal([]byte(r.Visible), &visible)
			fields = map[string]string{}
			for _, k := range visible {
				fields[k] = raw[k]
			}
			if fields["name"] == "" {
				fields["name"] = p.AgentName
			}
		}
		memories, next, e = readPortraitMemories(s.db.WithContext(ctx), p.OwnerUID, c.Query("cursor"), "", true)
		if e != nil {
			s.socialFailure(c, e)
			return
		}
	}
	var following bool
	if e = s.db.Raw(`SELECT EXISTS(SELECT 1 FROM social_follows WHERE follower_id=? AND followed_id=?)`, viewer, id).Scan(&following).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	reply(c, 200, map[string]any{"agent_id": strconv.FormatInt(id, 10), "is_official": p.IsOfficial, "fields": fields, "visible": visible, "memories": memories, "next_cursor": next, "following": following})
}
func (s *Service) putFollow(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialDecimal(c.Param("person_id"))
	var req struct {
		Following bool `json:"following"`
	}
	if id == 0 || id == viewer || decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_FOLLOW", "关注对象无效", nil)
		return
	}
	var valid bool
	e := s.db.WithContext(ctx).Raw(`SELECT EXISTS(SELECT 1 FROM agents a WHERE a.agent_id=? AND NOT EXISTS(SELECT 1 FROM user_relations WHERE rel_type=2 AND ((from_uid=? AND to_uid=?) OR (to_uid=? AND from_uid=?))))`, id, viewer, id, viewer, id).Scan(&valid).Error
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	if !valid {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	if req.Following {
		e = s.db.Exec(`INSERT INTO social_follows VALUES(?,?) ON CONFLICT DO NOTHING`, viewer, id).Error
	} else {
		e = s.db.Exec(`DELETE FROM social_follows WHERE follower_id=? AND followed_id=?`, viewer, id).Error
	}
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	reply(c, 200, map[string]any{"following": req.Following})
}

// The social onboarding confirms the reviewed portrait in one transaction. It
// keeps the existing context compiler and credential activation, without making
// an optional network goal or synthetic biography a signup prerequisite.
func (s *Service) confirmPortrait(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		Revision int64 `json:"revision"`
		Agreed   bool  `json:"agreed"`
	}
	if decodeBody(c, &req) != nil || !req.Agreed {
		fail(c, 400, "AGREEMENT_REQUIRED", "请同意用户协议后继续", nil)
		return
	}
	now := time.Now().UnixMilli()
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		r, e := readPortraitRow(tx, owner, true)
		if e != nil {
			return e
		}
		if r.Revision != req.Revision {
			return errConflict
		}
		var fields map[string]string
		_ = json.Unmarshal([]byte(r.Fields), &fields)
		if strings.TrimSpace(fields["name"]) == "" {
			return errConflict
		}
		var state struct {
			State    string
			Revision int64
		}
		if e = tx.Raw(`SELECT state,revision FROM agent_onboarding_v2 WHERE agent_id=? FOR UPDATE`, id).Scan(&state).Error; e != nil {
			return e
		}
		if state.State == "completed" {
			return nil
		}
		if state.State == "" {
			return gorm.ErrRecordNotFound
		}
		if e = tx.Exec(`INSERT INTO twin_agreement_acceptances(user_id,version,accepted_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`, owner, twinAgreementVersion, now).Error; e != nil {
			return e
		}
		// Registration consent allows these activities; the saved policy still limits
		// their rate. An existing settings row (including explicit denials) wins.
		if e = tx.Exec(`INSERT INTO agent_settings(agent_id,recurring_publish,auto_reply_pm,auto_comment,show_add_friend,updated_at) VALUES(?,true,true,true,true,?) ON CONFLICT DO NOTHING`, id, now).Error; e != nil {
			return e
		}
		_, revision, e := compileAndActivateContext(tx, id, now)
		if e != nil {
			return e
		}
		if e = tx.Exec(`UPDATE agent_principals SET status='active',last_seen_at=? WHERE agent_id=? AND status='limited' AND revoked_at IS NULL`, now, id).Error; e != nil {
			return e
		}
		if e = tx.Exec(`UPDATE agent_credential_sessions SET scopes=? WHERE principal_id IN(SELECT principal_id FROM agent_principals WHERE agent_id=?) AND revoked_at IS NULL AND expires_at>?`, pq.Array(principalScopesForOnboarding("completed")), id, now).Error; e != nil {
			return e
		}
		if e = tx.Exec(`UPDATE agents SET profile_completed_at=COALESCE(profile_completed_at,?),updated_at=? WHERE agent_id=?`, now, now, id).Error; e != nil {
			return e
		}
		return tx.Exec(`UPDATE agent_onboarding_v2 SET state='completed',current_step=5,revision=revision+1,active_context_revision=?,completed_at=?,updated_at=? WHERE agent_id=?`, revision, now, now, id).Error
	})
	if e != nil {
		if errors.Is(e, errConflict) {
			fail(c, 409, "REVISION_CONFLICT", "请重新读取并确认画像", nil)
		} else {
			s.socialFailure(c, e)
		}
		return
	}
	reply(c, 200, map[string]any{"completed": true})
}
