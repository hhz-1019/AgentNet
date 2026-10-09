package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

const twinAgreementVersion = "2026-10-09"

var twinUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type twinPersona struct {
	Traits           map[string]float64 `json:"traits"`
	SpeakingStyle    string             `json:"speaking_style"`
	DecisionStyle    string             `json:"decision_style"`
	RiskPreference   string             `json:"risk_preference"`
	SocialPreference string             `json:"social_preference"`
}
type twinEpisode struct {
	ID         string  `json:"id"`
	Content    string  `json:"content"`
	Emotion    float64 `json:"emotion_score"`
	Importance float64 `json:"importance"`
	OccurredAt *int64  `json:"occurred_at"`
	DecayRate  float64 `json:"decay_rate"`
}
type twinKnowledge struct {
	ID          string  `json:"id"`
	Concept     string  `json:"concept"`
	Description string  `json:"description"`
	Confidence  float64 `json:"confidence"`
}
type twinRelationship struct {
	ID          string  `json:"id"`
	TargetID    string  `json:"target_id"`
	Description string  `json:"description"`
	Intimacy    float64 `json:"intimacy"`
	Trust       float64 `json:"trust"`
	Emotion     float64 `json:"emotion"`
}
type twinProfile struct {
	Name          string             `json:"name"`
	BasicInfo     map[string]string  `json:"basic_info"`
	Persona       twinPersona        `json:"persona"`
	Episodes      []twinEpisode      `json:"episodes"`
	Knowledge     []twinKnowledge    `json:"knowledge"`
	Relationships []twinRelationship `json:"relationships"`
	CurrentGoal   string             `json:"current_goal"`
}
type twinPolicy struct {
	DailyPosts    int   `json:"daily_posts"`
	DailySearches int   `json:"daily_searches"`
	DailyFeedback int   `json:"daily_feedback"`
	Revision      int64 `json:"revision"`
}

func twinRange(v, lo, hi float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= lo && v <= hi
}
func validateTwinProfile(p twinProfile, required bool) error {
	if (required && (strings.TrimSpace(p.Name) == "" || strings.TrimSpace(p.CurrentGoal) == "")) || utf8.RuneCountInString(p.Name) > 80 || utf8.RuneCountInString(p.CurrentGoal) > 2000 {
		return errors.New("请填写昵称和当前目标，并遵守长度限制")
	}
	for k, v := range p.BasicInfo {
		if k != "role" && k != "city" && k != "languages" && k != "interests" {
			return errors.New("基础资料字段无效")
		}
		if utf8.RuneCountInString(v) > 1000 {
			return errors.New("基础资料过长")
		}
	}
	for _, v := range []string{p.Persona.SpeakingStyle, p.Persona.DecisionStyle, p.Persona.RiskPreference, p.Persona.SocialPreference} {
		if utf8.RuneCountInString(v) > 1000 {
			return errors.New("人格描述过长")
		}
	}
	for k, v := range p.Persona.Traits {
		if k != "extroversion" && k != "agreeableness" && k != "neuroticism" && k != "openness" && k != "conscientiousness" {
			return errors.New("人格维度无效")
		}
		if !twinRange(v, 0, 1) {
			return errors.New("人格权重需在 0–1 之间")
		}
	}
	if len(p.Episodes) > 50 || len(p.Knowledge) > 50 || len(p.Relationships) > 50 {
		return errors.New("每类初始记录最多 50 条")
	}
	ids := map[string]bool{}
	checkID := func(id string) bool {
		if !twinUUID.MatchString(id) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, r := range p.Episodes {
		if !checkID(r.ID) || strings.TrimSpace(r.Content) == "" || utf8.RuneCountInString(r.Content) > 4000 || !twinRange(r.Emotion, -1, 1) || !twinRange(r.Importance, 0, 1) || !twinRange(r.DecayRate, 0, 1) {
			return errors.New("经历记录或权重无效")
		}
	}
	for _, r := range p.Knowledge {
		if !checkID(r.ID) || strings.TrimSpace(r.Concept) == "" || utf8.RuneCountInString(r.Concept) > 200 || utf8.RuneCountInString(r.Description) > 4000 || !twinRange(r.Confidence, 0, 1) {
			return errors.New("知识记录或置信度无效")
		}
	}
	targets := map[string]bool{}
	for _, r := range p.Relationships {
		if !checkID(r.ID) || strings.TrimSpace(r.TargetID) == "" || targets[r.TargetID] || utf8.RuneCountInString(r.TargetID) > 200 || utf8.RuneCountInString(r.Description) > 2000 || !twinRange(r.Intimacy, 0, 1) || !twinRange(r.Trust, 0, 1) || !twinRange(r.Emotion, -1, 1) {
			return errors.New("关系记录或权重无效")
		}
		targets[r.TargetID] = true
	}
	return nil
}
func validTwinPolicy(p twinPolicy) bool {
	return p.DailyPosts >= 0 && p.DailyPosts <= 1000 && p.DailySearches >= 0 && p.DailySearches <= 1000 && p.DailyFeedback >= 0 && p.DailyFeedback <= 1000
}

func (s *Service) registerTwinRoutes(h *server.Hertz) {
	s.registerManagedRoutes(h)
	h.GET("/api/v2/console/twin", s.consoleAuth(false), s.getTwin)
	h.PUT("/api/v2/console/twin", s.consoleAuth(true), s.putTwin)
	h.GET("/api/v2/console/twin/policy", s.consoleAuth(false), s.getTwinPolicy)
	h.PUT("/api/v2/console/twin/policy", s.consoleAuth(true), s.putTwinPolicy)
	h.GET("/api/v2/agent-context/twin", s.agentAuth("context:read"), s.requireCompleted, s.getTwin)
	h.GET("/api/v2/agent-context/twin/policy", s.agentAuth("context:read"), s.requireCompleted, s.getTwinPolicy)
}
func (s *Service) twinOwner(c *app.RequestContext) (string, int64, bool) {
	id, ok := agentID(c)
	if !ok {
		fail(c, 401, "OWNER_BINDING_REQUIRED", "请先注册或登录", nil)
		return "", 0, false
	}
	var owner string
	if err := s.db.Raw(`SELECT owner_uid FROM agent_owners WHERE agent_id=?`, id).Scan(&owner).Error; err != nil {
		fail(c, 500, "TWIN_READ_FAILED", "资料暂时无法读取", nil)
		return "", id, false
	}
	if owner == "" {
		fail(c, 403, "OWNER_BINDING_REQUIRED", "请先完成账号注册", nil)
		return "", id, false
	}
	// A handoff session alone cannot read a bound owner's private cognition.
	if value, exists := c.Get("console_session_id"); exists {
		var verified bool
		if err := s.db.Raw(`SELECT EXISTS(SELECT 1 FROM console_v2_sessions WHERE session_id=? AND owner_uid=? AND auth_method='uid_password' AND status='active')`, value, owner).Scan(&verified).Error; err != nil || !verified {
			fail(c, 403, "OWNER_BINDING_REQUIRED", "请登录所有者账号后读取私人资料", nil)
			return "", id, false
		}
	}
	return owner, id, true
}
func ensureTwinUser(tx *gorm.DB, owner string, now int64) error {
	if err := tx.Exec(`INSERT INTO twin_users(user_id,created_at,last_active_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING`, owner, now, now).Error; err != nil {
		return err
	}
	return tx.Exec(`INSERT INTO twin_persona(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING`, owner, now).Error
}
func (s *Service) getTwin(_ context.Context, c *app.RequestContext) {
	owner, _, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var data string
	err := s.db.Raw(`SELECT json_build_object('revision',u.revision,'agreement_accepted',EXISTS(SELECT 1 FROM twin_agreement_acceptances a WHERE a.user_id=u.user_id AND a.version='2026-10-09'),'profile',json_build_object('name',u.name,'basic_info',u.basic_info,'persona',json_build_object('traits',p.traits,'speaking_style',p.speaking_style,'decision_style',p.decision_style,'risk_preference',p.risk_preference,'social_preference',p.social_preference),
 'episodes',COALESCE((SELECT json_agg(json_build_object('id',memory_id,'content',content,'emotion_score',emotion_score,'importance',importance,'occurred_at',occurred_at,'decay_rate',decay_rate) ORDER BY created_at,memory_id) FROM twin_episodic_memory WHERE user_id=u.user_id),'[]'),
 'knowledge',COALESCE((SELECT json_agg(json_build_object('id',memory_id,'concept',concept,'description',description,'confidence',confidence) ORDER BY updated_at,memory_id) FROM twin_semantic_memory WHERE user_id=u.user_id),'[]'),
 'relationships',COALESCE((SELECT json_agg(json_build_object('id',relationship_id,'target_id',target_id,'description',description,'intimacy',intimacy,'trust',trust,'emotion',emotion) ORDER BY target_id) FROM twin_relationships WHERE user_id=u.user_id),'[]'),
 'current_goal',u.current_goal))::text FROM twin_users u JOIN twin_persona p USING(user_id) WHERE u.user_id=?`, owner).Scan(&data).Error
	if err != nil {
		fail(c, 500, "TWIN_READ_FAILED", "资料暂时无法读取", nil)
		return
	}
	if data == "" {
		reply(c, 200, map[string]any{"revision": int64(0), "profile": twinProfile{BasicInfo: map[string]string{}, Persona: twinPersona{Traits: map[string]float64{}}, Episodes: []twinEpisode{}, Knowledge: []twinKnowledge{}, Relationships: []twinRelationship{}}})
		return
	}
	reply(c, 200, json.RawMessage(data))
}
func (s *Service) putTwin(_ context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		ExpectedRevision int64       `json:"expected_revision"`
		Profile          twinProfile `json:"profile"`
		AgreementVersion string      `json:"agreement_version"`
	}
	if decodeBody(c, &req) != nil || validateTwinProfile(req.Profile, true) != nil || req.ExpectedRevision < 0 {
		fail(c, 400, "TWIN_INVALID", "请检查必填资料、记录和权重范围", nil)
		return
	}
	now := time.Now().UnixMilli()
	revision := int64(0)
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := ensureTwinUser(tx, owner, now); err != nil {
			return err
		}
		var current int64
		if err := tx.Raw(`SELECT revision FROM twin_users WHERE user_id=? FOR UPDATE`, owner).Scan(&current).Error; err != nil {
			return err
		}
		// Zero represents a newly registered account whose cognition is not yet created.
		if current != req.ExpectedRevision && !(req.ExpectedRevision == 0 && current == 1) {
			return errConflict
		}
		revision = current + 1
		info, _ := json.Marshal(req.Profile.BasicInfo)
		traits, _ := json.Marshal(req.Profile.Persona.Traits)
		if string(info) == "null" {
			info = []byte("{}")
		}
		if string(traits) == "null" {
			traits = []byte("{}")
		}
		if err := tx.Exec(`UPDATE twin_users SET name=?,basic_info=?::jsonb,current_goal=?,revision=?,last_active_at=? WHERE user_id=?`, strings.TrimSpace(req.Profile.Name), string(info), req.Profile.CurrentGoal, revision, now, owner).Error; err != nil {
			return err
		}
		p := req.Profile.Persona
		if err := tx.Exec(`UPDATE twin_persona SET traits=?::jsonb,speaking_style=?,decision_style=?,risk_preference=?,social_preference=?,updated_at=? WHERE user_id=?`, string(traits), p.SpeakingStyle, p.DecisionStyle, p.RiskPreference, p.SocialPreference, now, owner).Error; err != nil {
			return err
		}
		// Preserve retrieval metadata for retained IDs; reject another owner's IDs.
		for _, r := range req.Profile.Episodes {
			res := tx.Exec(`INSERT INTO twin_episodic_memory(memory_id,user_id,content,emotion_score,importance,occurred_at,decay_rate,created_at) VALUES(?::uuid,?,?,?,?,?,?,?) ON CONFLICT(memory_id) DO UPDATE SET content=EXCLUDED.content,emotion_score=EXCLUDED.emotion_score,importance=EXCLUDED.importance,occurred_at=EXCLUDED.occurred_at,decay_rate=EXCLUDED.decay_rate,embedding=CASE WHEN twin_episodic_memory.content=EXCLUDED.content THEN twin_episodic_memory.embedding ELSE NULL END WHERE twin_episodic_memory.user_id=EXCLUDED.user_id`, r.ID, owner, r.Content, r.Emotion, r.Importance, r.OccurredAt, r.DecayRate, now)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return errConflict
			}
		}
		for _, r := range req.Profile.Knowledge {
			res := tx.Exec(`INSERT INTO twin_semantic_memory(memory_id,user_id,concept,description,confidence,updated_at) VALUES(?::uuid,?,?,?,?,?) ON CONFLICT(memory_id) DO UPDATE SET concept=EXCLUDED.concept,description=EXCLUDED.description,confidence=EXCLUDED.confidence,updated_at=EXCLUDED.updated_at,embedding=CASE WHEN twin_semantic_memory.concept=EXCLUDED.concept AND twin_semantic_memory.description=EXCLUDED.description THEN twin_semantic_memory.embedding ELSE NULL END WHERE twin_semantic_memory.user_id=EXCLUDED.user_id`, r.ID, owner, r.Concept, r.Description, r.Confidence, now)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return errConflict
			}
		}
		for _, r := range req.Profile.Relationships {
			res := tx.Exec(`INSERT INTO twin_relationships(relationship_id,user_id,target_id,description,intimacy,trust,emotion) VALUES(?::uuid,?,?,?,?,?,?) ON CONFLICT(relationship_id) DO UPDATE SET target_id=EXCLUDED.target_id,description=EXCLUDED.description,intimacy=EXCLUDED.intimacy,trust=EXCLUDED.trust,emotion=EXCLUDED.emotion WHERE twin_relationships.user_id=EXCLUDED.user_id`, r.ID, owner, r.TargetID, r.Description, r.Intimacy, r.Trust, r.Emotion)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return errConflict
			}
		}
		for _, item := range []struct {
			table, key string
			ids        []string
		}{{"twin_episodic_memory", "memory_id", episodeIDs(req.Profile.Episodes)}, {"twin_semantic_memory", "memory_id", knowledgeIDs(req.Profile.Knowledge)}, {"twin_relationships", "relationship_id", relationshipIDs(req.Profile.Relationships)}} {
			if len(item.ids) == 0 {
				if err := tx.Exec("DELETE FROM "+item.table+" WHERE user_id=?", owner).Error; err != nil {
					return err
				}
			} else if err := tx.Exec("DELETE FROM "+item.table+" WHERE user_id=? AND "+item.key+"::text NOT IN ?", owner, item.ids).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(`INSERT INTO twin_working_memory(agent_id,user_id,current_goal,last_updated,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET user_id=EXCLUDED.user_id,current_goal=EXCLUDED.current_goal,last_updated=EXCLUDED.last_updated,expires_at=EXCLUDED.expires_at`, id, owner, req.Profile.CurrentGoal, now, now+int64(24*time.Hour/time.Millisecond)).Error; err != nil {
			return err
		}
		if req.AgreementVersion == twinAgreementVersion {
			return tx.Exec(`INSERT INTO twin_agreement_acceptances(user_id,version,accepted_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`, owner, twinAgreementVersion, now).Error
		}
		return nil
	})
	if errors.Is(err, errConflict) || isUniqueViolation(err) {
		fail(c, 409, "REVISION_CONFLICT", "资料已更新，请重新读取后保存", nil)
		return
	}
	if err != nil {
		fail(c, 500, "TWIN_SAVE_FAILED", "资料未保存，请重试", nil)
		return
	}
	reply(c, 200, map[string]any{"revision": revision})
}
func episodeIDs(rows []twinEpisode) []string {
	ids := []string{}
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}
func knowledgeIDs(rows []twinKnowledge) []string {
	ids := []string{}
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}
func relationshipIDs(rows []twinRelationship) []string {
	ids := []string{}
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}

func (s *Service) getTwinPolicy(_ context.Context, c *app.RequestContext) {
	_, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	p := twinPolicy{DailyPosts: 3, DailySearches: 20, DailyFeedback: 10}
	if err := s.db.Raw(`SELECT daily_posts,daily_searches,daily_feedback,revision FROM twin_agent_policy WHERE agent_id=?`, id).Scan(&p).Error; err != nil {
		fail(c, 500, "POLICY_READ_FAILED", "额度暂时无法读取", nil)
		return
	}
	reply(c, 200, p)
}
func (s *Service) putTwinPolicy(_ context.Context, c *app.RequestContext) {
	_, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req twinPolicy
	if decodeBody(c, &req) != nil || !validTwinPolicy(req) || req.Revision < 0 {
		fail(c, 400, "POLICY_INVALID", "每日额度需为 0–1000 的整数", nil)
		return
	}
	var revision int64
	err := s.db.Raw(`INSERT INTO twin_agent_policy(agent_id,daily_posts,daily_searches,daily_feedback,updated_at) SELECT ?,?,?,?,? WHERE ?=0 ON CONFLICT(agent_id) DO UPDATE SET daily_posts=EXCLUDED.daily_posts,daily_searches=EXCLUDED.daily_searches,daily_feedback=EXCLUDED.daily_feedback,revision=twin_agent_policy.revision+1,updated_at=EXCLUDED.updated_at WHERE twin_agent_policy.revision=? RETURNING revision`, id, req.DailyPosts, req.DailySearches, req.DailyFeedback, time.Now().UnixMilli(), req.Revision, req.Revision).Scan(&revision).Error
	// UPDATE existing rows when the caller has a nonzero revision.
	if err == nil && revision == 0 && req.Revision > 0 {
		err = s.db.Raw(`UPDATE twin_agent_policy SET daily_posts=?,daily_searches=?,daily_feedback=?,revision=revision+1,updated_at=? WHERE agent_id=? AND revision=? RETURNING revision`, req.DailyPosts, req.DailySearches, req.DailyFeedback, time.Now().UnixMilli(), id, req.Revision).Scan(&revision).Error
	}
	if err != nil {
		fail(c, 500, "POLICY_SAVE_FAILED", "额度未保存，请重试", nil)
		return
	}
	if revision == 0 {
		fail(c, 409, "REVISION_CONFLICT", "额度已更新，请重新读取", nil)
		return
	}
	reply(c, 200, map[string]any{"revision": revision})
}

// Atomic daily admission limits apply to Agent requests; human console actions
// remain available. Failed downstream attempts count to prevent retry storms.
func (s *Service) twinQuota(activity string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		id, ok := agentID(c)
		if !ok {
			c.Abort()
			return
		}
		var p twinPolicy
		if err := s.db.Raw(`SELECT daily_posts,daily_searches,daily_feedback,revision FROM twin_agent_policy WHERE agent_id=?`, id).Scan(&p).Error; err != nil {
			fail(c, 503, "ACTIVITY_UNAVAILABLE", "活动额度暂时无法核对", nil)
			c.Abort()
			return
		}
		if p.Revision == 0 {
			c.Next(ctx)
			return
		}
		limit := map[string]int{"posts": p.DailyPosts, "searches": p.DailySearches, "feedback": p.DailyFeedback}[activity]
		day := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
		var used int
		err := s.db.Raw(`INSERT INTO twin_daily_usage(agent_id,day,activity,used) SELECT ?,?::date,?,1 WHERE ?>0 ON CONFLICT(agent_id,day,activity) DO UPDATE SET used=twin_daily_usage.used+1 WHERE twin_daily_usage.used<? RETURNING used`, id, day, activity, limit, limit).Scan(&used).Error
		if err != nil {
			fail(c, 503, "ACTIVITY_UNAVAILABLE", "活动额度暂时无法核对", nil)
			c.Abort()
			return
		}
		if used == 0 {
			fail(c, 429, "DAILY_ACTIVITY_LIMIT", "已达到主人设置的每日活动上限", map[string]any{"activity": activity, "limit": limit, "timezone": "Asia/Shanghai"})
			c.Abort()
			return
		}
		c.Next(ctx)
	}
}
