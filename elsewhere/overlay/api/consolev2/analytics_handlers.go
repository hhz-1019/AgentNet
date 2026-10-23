package consolev2

import (
	"context"
	"encoding/json"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Session-derived identity only: the browser cannot submit another owner's UID
// or a timestamp. Delegated/managed activity never counts as human activity.
func (s *Service) analyticsHeartbeat(_ context.Context, c *app.RequestContext) {
	session, _ := c.Get("console_session_id")
	now := time.Now().UnixMilli()
	err := s.db.Exec(`INSERT INTO analytics_owner_days(owner_uid,day,last_seen_at)
 SELECT cs.owner_uid,(to_timestamp(?::double precision/1000) AT TIME ZONE 'Asia/Shanghai')::date,?
 FROM console_v2_sessions cs WHERE cs.session_id=? AND cs.owner_uid IS NOT NULL
 AND cs.status='active' AND cs.idle_expires_at>? AND cs.absolute_expires_at>?
 AND NOT EXISTS(SELECT 1 FROM managed_delegations d WHERE d.session_id=cs.session_id)
 AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.owner_uid=cs.owner_uid)
 ON CONFLICT(owner_uid,day) DO UPDATE SET last_seen_at=GREATEST(analytics_owner_days.last_seen_at,EXCLUDED.last_seen_at)
 WHERE analytics_owner_days.last_seen_at < EXCLUDED.last_seen_at-30000`, now, now, session, now, now).Error
	if err != nil {
		fail(c, 503, "ANALYTICS_UNAVAILABLE", "使用情况暂时无法记录", nil)
		return
	}
	reply(c, 200, map[string]bool{"recorded": true})
}

func (s *Service) getAnalytics(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	if _, ok := s.requireManaged(c); !ok {
		return
	}
	days := 7
	switch c.Query("days") {
	case "", "7":
	case "14":
		days = 14
	case "30":
		days = 30
	default:
		fail(c, 400, "INVALID_RANGE", "请选择 7、14 或 30 天", nil)
		return
	}
	queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	data, err := analyticsSnapshot(s.db.WithContext(queryCtx), time.Now(), days)
	if err != nil {
		fail(c, 503, "ANALYTICS_UNAVAILABLE", "统计暂时无法读取，请稍后刷新", nil)
		return
	}
	reply(c, 200, data)
}

func analyticsSnapshot(db *gorm.DB, now time.Time, days int) (map[string]any, error) {
	var raw string
	err := db.Raw(analyticsQuery, now.UnixMilli(), days).Scan(&raw).Error
	if err != nil {
		return nil, err
	}
	var data map[string]any
	err = json.Unmarshal([]byte(raw), &data)
	return data, err
}

// A single PostgreSQL statement gives all sections the same MVCC snapshot.
const analyticsQuery = `WITH
 p AS (SELECT ?::bigint AS now_ms,?::int AS days),
 bounds AS (SELECT p.*, (to_timestamp(now_ms::double precision/1000) AT TIME ZONE 'Asia/Shanghai')::date AS today FROM p),
 b AS (SELECT bounds.*, ((today-(days-1))::timestamp AT TIME ZONE 'Asia/Shanghai') AS start_at FROM bounds),
 coverage AS (SELECT started_at,(to_timestamp(started_at::double precision/1000) AT TIME ZONE 'Asia/Shanghai')::date AS day FROM analytics_collection WHERE id=1),
 owners AS MATERIALIZED (SELECT h.*, (to_timestamp(h.created_at::double precision/1000) AT TIME ZONE 'Asia/Shanghai')::date AS registered_day
 FROM human_accounts h WHERE NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.owner_uid=h.uid)),
 member_agents AS MATERIALIZED (SELECT a.agent_id,o.owner_uid FROM agents a LEFT JOIN agent_owners o USING(agent_id)
 WHERE NOT a.is_official AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=a.agent_id)),
 connected AS MATERIALIZED (SELECT a.* FROM member_agents a JOIN agent_onboarding_v2 n USING(agent_id)
 WHERE n.state='completed' AND EXISTS(SELECT 1 FROM agent_principals k WHERE k.agent_id=a.agent_id AND k.key_type='ed25519-v1' AND k.status='active')),
 events AS MATERIALIZED (SELECT e.*, a.owner_uid,(to_timestamp(e.created_at::double precision/1000) AT TIME ZONE 'Asia/Shanghai')::date AS day
 FROM analytics_agent_events e JOIN member_agents a USING(agent_id),b WHERE e.created_at>=extract(epoch FROM b.start_at)*1000 AND e.created_at<=b.now_ms),
 daily AS (SELECT d::date AS day FROM b,generate_series(b.today-(b.days-1),b.today,interval '1 day') d),
 cohorts AS (SELECT d::date AS day FROM b,generate_series(b.today-(b.days+7),b.today-8,interval '1 day') d),
 retention AS (SELECT c.day,count(o.uid) AS registered,
 CASE WHEN c.day>coverage.day THEN count(o.uid) ELSE NULL END AS eligible,
 CASE WHEN c.day>coverage.day THEN count(a.owner_uid) ELSE NULL END AS retained
 FROM cohorts c CROSS JOIN coverage LEFT JOIN owners o ON o.registered_day=c.day
 LEFT JOIN analytics_owner_days a ON a.owner_uid=o.uid AND a.day=c.day+7
 GROUP BY c.day,coverage.day),
 pairs AS (SELECT LEAST(m.sender_id,m.receiver_id) AS a,GREATEST(m.sender_id,m.receiver_id) AS z
 FROM private_messages m JOIN member_agents s ON s.agent_id=m.sender_id JOIN member_agents r ON r.agent_id=m.receiver_id,b
 WHERE m.sender_id<>m.receiver_id AND (s.owner_uid IS NULL OR r.owner_uid IS NULL OR s.owner_uid<>r.owner_uid)
 AND m.created_at>=extract(epoch FROM b.start_at)*1000 AND m.created_at<=b.now_ms
 GROUP BY 1,2 HAVING count(DISTINCT m.sender_id)=2),
 feature_names AS (SELECT * FROM (VALUES ('publish','发布动态'),('comment','评论'),('message','私信'),('group_message','群聊'),('like','点赞'),('save','收藏'),('follow','关注')) v(key,label))
 SELECT json_build_object(
 'generated_at',b.now_ms,'timezone','Asia/Shanghai','days',b.days,'today',b.today,
 'collection_started_at',(SELECT started_at FROM coverage),
 'metrics',json_build_object(
   'users',(SELECT count(*) FROM owners),
   'new_users',(SELECT count(*) FROM owners WHERE registered_day=b.today),
   'yesterday_new_users',(SELECT count(*) FROM owners WHERE registered_day=b.today-1),
   'dau',(SELECT count(*) FROM analytics_owner_days a JOIN owners o ON o.uid=a.owner_uid WHERE a.day=b.today),
   'yesterday_dau',CASE WHEN b.today-1>(SELECT day FROM coverage) THEN (SELECT count(*) FROM analytics_owner_days a JOIN owners o ON o.uid=a.owner_uid WHERE a.day=b.today-1) ELSE NULL END,
   'online',(SELECT count(DISTINCT a.owner_uid) FROM analytics_owner_days a JOIN owners o ON o.uid=a.owner_uid WHERE a.last_seen_at>=b.now_ms-120000),
   'agents',(SELECT count(*) FROM connected),
   'active_agents',(SELECT count(DISTINCT e.agent_id) FROM events e JOIN connected c USING(agent_id) WHERE e.day=b.today),
   'connections',(SELECT count(*) FROM pairs),
   'connected_users',(SELECT count(DISTINCT owner_uid) FROM connected WHERE owner_uid IS NOT NULL),
   'retention_eligible',(SELECT sum(eligible) FROM retention),
   'retention_returned',(SELECT sum(retained) FROM retention),
   'managed_accounts',(SELECT count(*) FROM managed_members),
   'managed_active_today',(SELECT count(DISTINCT e.agent_id) FROM analytics_agent_events e JOIN managed_members m USING(agent_id) WHERE e.created_at>=extract(epoch FROM (b.today::timestamp AT TIME ZONE 'Asia/Shanghai'))*1000 AND e.created_at<=b.now_ms)
 ),
 'trend',COALESCE((SELECT json_agg(json_build_object('day',d.day,
   'new_users',(SELECT count(*) FROM owners o WHERE o.registered_day=d.day),
   'dau',CASE WHEN d.day>=(SELECT day FROM coverage) THEN (SELECT count(*) FROM analytics_owner_days a JOIN owners o ON o.uid=a.owner_uid WHERE a.day=d.day) ELSE NULL END,
   'partial',d.day=(SELECT day FROM coverage) OR d.day=b.today,
   'active_agents',(SELECT count(DISTINCT e.agent_id) FROM events e JOIN connected c USING(agent_id) WHERE e.day=d.day)
 ) ORDER BY d.day) FROM daily d),'[]'::json),
 'retention',COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.day) FROM retention r),'[]'::json),
 'features',COALESCE((SELECT json_agg(row_to_json(f) ORDER BY f.events DESC,f.key) FROM (
 SELECT n.key,n.label,count(e.event_key) AS events,count(DISTINCT e.agent_id) AS agents FROM feature_names n LEFT JOIN events e ON e.feature=n.key GROUP BY n.key,n.label) f),'[]'::json)
 )::text FROM b`
