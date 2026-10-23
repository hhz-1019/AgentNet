package consolev2

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Telemetry is best effort and must never turn successful signup into failure.
// Identity and timestamps are derived only from the authenticated Console session.
func (s *Service) recordRegistration(c *app.RequestContext, event, errorCode, errorStage string) bool {
	id, ok := agentID(c)
	if !ok || s.db == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer cancel()
	now := time.Now().UnixMilli()
	result := s.db.WithContext(ctx).Exec(`INSERT INTO analytics_registration_journeys
 (agent_id,source,started_at,last_seen_at,sms_at,submitted_at,profile_at,last_input,error_code,error_stage,error_at)
 SELECT a.agent_id,CASE WHEN EXISTS(SELECT 1 FROM agent_owners o WHERE o.agent_id=a.agent_id) THEN 'legacy' ELSE 'observed' END,
 ?,?,CASE WHEN ?='sms' THEN ?::bigint END,CASE WHEN ?='submit' THEN ?::bigint END,CASE WHEN ?='profile' THEN ?::bigint END,
 CASE WHEN ? IN ('form','phone','code','password','confirm_password','profile') THEN ? ELSE 'form' END,
 NULLIF(?,''),NULLIF(?,''),CASE WHEN ?<>'' THEN ?::bigint END
 FROM agents a JOIN agent_onboarding_v2 n USING(agent_id)
 WHERE a.agent_id=? AND NOT a.is_official AND n.state<>'completed'
 AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=a.agent_id)
 ON CONFLICT(agent_id) DO UPDATE SET
 source=CASE WHEN analytics_registration_journeys.source='legacy' AND EXCLUDED.source='observed' THEN 'observed' ELSE analytics_registration_journeys.source END,
 started_at=CASE WHEN analytics_registration_journeys.source='legacy' AND EXCLUDED.source='observed' THEN EXCLUDED.started_at ELSE analytics_registration_journeys.started_at END,
 last_seen_at=EXCLUDED.last_seen_at,
 sms_at=COALESCE(analytics_registration_journeys.sms_at,EXCLUDED.sms_at),
 submitted_at=COALESCE(analytics_registration_journeys.submitted_at,EXCLUDED.submitted_at),
 profile_at=COALESCE(analytics_registration_journeys.profile_at,EXCLUDED.profile_at),
 last_input=CASE WHEN ? IN ('form','phone','code','password','confirm_password','profile') THEN ? ELSE analytics_registration_journeys.last_input END,
 error_code=COALESCE(EXCLUDED.error_code,analytics_registration_journeys.error_code),
 error_stage=COALESCE(EXCLUDED.error_stage,analytics_registration_journeys.error_stage),
 error_at=COALESCE(EXCLUDED.error_at,analytics_registration_journeys.error_at)
 WHERE ?<>'heartbeat' OR analytics_registration_journeys.last_seen_at IS NULL OR analytics_registration_journeys.last_seen_at<?`,
		now, now, event, now, event, now, event, now, event, event, errorCode, errorStage, errorCode, now, id, event, event, event, now-30000)
	return result.Error == nil
}

func (s *Service) registrationProgress(_ context.Context, c *app.RequestContext) {
	var req struct {
		Event string `json:"event"`
	}
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_EVENT", "注册步骤无效", nil)
		return
	}
	switch req.Event {
	case "form", "phone", "code", "password", "confirm_password", "profile", "heartbeat":
	default:
		fail(c, 400, "INVALID_EVENT", "注册步骤无效", nil)
		return
	}
	if !s.recordRegistration(c, req.Event, "", "") {
		fail(c, 503, "TRACKING_UNAVAILABLE", "步骤记录暂不可用", nil)
		return
	}
	reply(c, 200, map[string]any{"recorded": true})
}

var registrationErrorCode = regexp.MustCompile(`^[A-Z_]{1,48}$`)

func (s *Service) registrationOutcome(c *app.RequestContext, stage string) {
	if c.Response.StatusCode() < 400 {
		if stage == "sms" {
			s.recordRegistration(c, "sms", "", "")
		}
		return
	}
	var result struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(c.Response.Body(), &result)
	code := result.Error.Code
	if !registrationErrorCode.MatchString(code) {
		code = "REQUEST_FAILED"
	}
	s.recordRegistration(c, "error", code, stage)
}

func (s *Service) getRegistrationAnalytics(ctx context.Context, c *app.RequestContext) {
	if _, ok := s.requireManaged(c); !ok {
		return
	}
	days, err := strconv.Atoi(c.DefaultQuery("days", "7"))
	if err != nil || (days != 7 && days != 30 && days != 90) {
		fail(c, 400, "INVALID_RANGE", "请选择 7、30 或 90 天", nil)
		return
	}
	idle, err := strconv.Atoi(c.DefaultQuery("idle", "30"))
	if err != nil || (idle != 30 && idle != 1440) {
		fail(c, 400, "INVALID_IDLE", "请选择 30 分钟或 24 小时", nil)
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 100000 {
		fail(c, 400, "INVALID_PAGE", "页码无效", nil)
		return
	}
	status := c.DefaultQuery("status", "all")
	if status != "all" && status != "dormant" && status != "active" && status != "completed" && status != "legacy" {
		fail(c, 400, "INVALID_FILTER", "状态无效", nil)
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(q) > 80 {
		fail(c, 400, "INVALID_SEARCH", "搜索最多 80 字", nil)
		return
	}
	queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	data, err := registrationSnapshot(s.db.WithContext(queryCtx), time.Now(), days, idle, page, status, q)
	if err != nil {
		fail(c, 503, "REGISTRATION_UNAVAILABLE", "注册分析暂不可用，请重试", nil)
		return
	}
	reply(c, 200, data)
}

func registrationSnapshot(db *gorm.DB, now time.Time, days, idle, page int, status, q string) (map[string]any, error) {
	var raw string
	err := db.Raw(`WITH p AS (SELECT ?::bigint AS now_ms,?::int AS days,?::bigint AS idle_ms,?::int AS page,?::text AS status,?::text AS q),
 base AS MATERIALIZED (
 SELECT j.*,a.agent_name AS name,h.account_number::text AS number,h.created_at AS registered_at,n.completed_at,
 CASE WHEN n.state='completed' THEN 6 WHEN j.profile_at IS NOT NULL THEN 5 WHEN h.uid IS NOT NULL THEN 4 WHEN j.submitted_at IS NOT NULL THEN 3 WHEN j.sms_at IS NOT NULL THEN 2 ELSE 1 END AS step,
 CASE WHEN j.source='legacy' THEN 'legacy' WHEN n.state='completed' THEN 'completed' WHEN j.last_seen_at<=p.now_ms-p.idle_ms THEN 'dormant' ELSE 'active' END AS status
 FROM analytics_registration_journeys j JOIN agents a USING(agent_id) JOIN agent_onboarding_v2 n USING(agent_id)
 LEFT JOIN agent_owners o USING(agent_id) LEFT JOIN human_accounts h ON h.uid=o.owner_uid CROSS JOIN p
 WHERE NOT a.is_official AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=j.agent_id OR m.owner_uid=o.owner_uid)
 AND ((j.source='observed' AND j.started_at >= (extract(epoch FROM (date_trunc('day',to_timestamp(p.now_ms/1000.0) AT TIME ZONE 'Asia/Shanghai')-(p.days-1)*interval '1 day') AT TIME ZONE 'Asia/Shanghai')*1000)::bigint)
 OR (j.source='legacy' AND n.state<>'completed'))
 ), selected AS (SELECT b.* FROM base b,p WHERE (p.status='all' OR b.status=p.status) AND (p.q='' OR strpos(COALESCE(b.number,''),p.q)>0 OR strpos(b.agent_id::text,p.q)>0 OR strpos(lower(b.name),lower(p.q))>0)),
 steps AS (SELECT step,(SELECT count(*) FROM base WHERE source='observed' AND base.step>=s.step) AS reached,
 (SELECT count(*) FROM base WHERE status='dormant' AND base.step=s.step) AS stalled FROM generate_series(1,6) s(step))
 SELECT json_build_object('generated_at',p.now_ms,'days',p.days,'idle_minutes',p.idle_ms/60000,'page',p.page,'page_size',25,
 'collection_started_at',(SELECT started_at FROM analytics_registration_collection WHERE id=1),
 'summary',json_build_object('started',(SELECT count(*) FROM base WHERE source='observed'),'completed',(SELECT count(*) FROM base WHERE status='completed'),'dormant',(SELECT count(*) FROM base WHERE status='dormant'),'active',(SELECT count(*) FROM base WHERE status='active'),'legacy_pending',(SELECT count(*) FROM base WHERE source='legacy')),
 'funnel',(SELECT json_agg(row_to_json(steps) ORDER BY step) FROM steps),
 'total',(SELECT count(*) FROM selected),
 'journeys',COALESCE((SELECT json_agg(row_to_json(v) ORDER BY v.sort_at DESC,v.agent_id DESC) FROM (SELECT agent_id::text,name,number,source,step,status,last_input,started_at,last_seen_at,sms_at,submitted_at,registered_at,profile_at,completed_at,error_code,error_stage,error_at,COALESCE(last_seen_at,started_at) AS sort_at FROM selected ORDER BY COALESCE(last_seen_at,started_at) DESC,agent_id::text DESC LIMIT 25 OFFSET ((SELECT page FROM p)-1)*25) v),'[]'::json))::text FROM p`, now.UnixMilli(), days, int64(idle)*60000, page, status, q).Scan(&raw).Error
	if err != nil {
		return nil, err
	}
	var data map[string]any
	err = json.Unmarshal([]byte(raw), &data)
	return data, err
}
