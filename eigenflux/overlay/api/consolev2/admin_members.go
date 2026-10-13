package consolev2

import (
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *Service) getAdminMembers(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	if _, ok := s.requireManaged(c); !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(q) > 80 {
		fail(c, 400, "INVALID_SEARCH", "搜索内容最多 80 字", nil)
		return
	}
	filter := c.DefaultQuery("status", "all")
	if filter != "all" && filter != "online" && filter != "connected" && filter != "unconnected" {
		fail(c, 400, "INVALID_FILTER", "请选择有效的成员状态", nil)
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 100000 {
		fail(c, 400, "INVALID_PAGE", "页码无效", nil)
		return
	}
	queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var raw string
	// strpos implements literal substring search: % and _ are not wildcard input.
	err = s.db.WithContext(queryCtx).Raw(`WITH
 params AS (SELECT ?::bigint AS now_ms,?::text AS search,?::text AS filter,?::int AS page),
 accounts AS MATERIALIZED (
 SELECT h.uid,h.account_number::text AS number,h.created_at,
 COALESCE((SELECT a.agent_name FROM agent_owners o JOIN agents a USING(agent_id) WHERE o.owner_uid=h.uid AND NOT a.is_official ORDER BY o.created_at,o.agent_id LIMIT 1),'未设置名称') AS name,
 (SELECT max(d.last_seen_at) FROM analytics_owner_days d WHERE d.owner_uid=h.uid) AS last_seen_at,
 (SELECT count(*) FROM agent_owners o JOIN agents a USING(agent_id) JOIN agent_onboarding_v2 n USING(agent_id) WHERE o.owner_uid=h.uid AND NOT a.is_official AND n.state='completed' AND EXISTS(SELECT 1 FROM agent_principals p WHERE p.agent_id=a.agent_id AND p.key_type='ed25519-v1' AND p.status='active')) AS connected_agents,
 COALESCE((SELECT json_agg(json_build_object('id',a.agent_id::text,'name',a.agent_name,'connected',n.state='completed' AND EXISTS(SELECT 1 FROM agent_principals p WHERE p.agent_id=a.agent_id AND p.key_type='ed25519-v1' AND p.status='active')) ORDER BY o.created_at,o.agent_id) FROM agent_owners o JOIN agents a USING(agent_id) LEFT JOIN agent_onboarding_v2 n USING(agent_id) WHERE o.owner_uid=h.uid AND NOT a.is_official),'[]'::json) AS agents
 FROM human_accounts h WHERE NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.owner_uid=h.uid)
 ), filtered AS (SELECT a.*,COALESCE(a.last_seen_at>=p.now_ms-120000,false) AS online FROM accounts a,params p WHERE
 (p.search='' OR strpos(a.number,p.search)>0 OR strpos(lower(a.name),lower(p.search))>0 OR EXISTS(SELECT 1 FROM agent_owners o JOIN agents g USING(agent_id) WHERE o.owner_uid=a.uid AND NOT g.is_official AND strpos(lower(g.agent_name),lower(p.search))>0)) AND
 (p.filter='all' OR (p.filter='online' AND a.last_seen_at>=p.now_ms-120000) OR (p.filter='connected' AND a.connected_agents>0) OR (p.filter='unconnected' AND a.connected_agents=0)))
 SELECT json_build_object('generated_at',p.now_ms,'page',p.page,'page_size',25,'total',(SELECT count(*) FROM filtered),
 'summary',json_build_object('users',(SELECT count(*) FROM accounts),'online',(SELECT count(*) FROM accounts WHERE last_seen_at>=p.now_ms-120000),'connected',(SELECT count(*) FROM accounts WHERE connected_agents>0)),
 'members',COALESCE((SELECT json_agg(row_to_json(m) ORDER BY m.created_at DESC,m.number DESC) FROM (SELECT number,name,created_at,last_seen_at,connected_agents,online,agents FROM filtered ORDER BY created_at DESC,number DESC LIMIT 25 OFFSET ((SELECT page FROM params)-1)*25)m),'[]'::json))::text FROM params p`, time.Now().UnixMilli(), q, filter, page).Scan(&raw).Error
	if err != nil {
		fail(c, 503, "MEMBERS_UNAVAILABLE", "成员列表暂时无法读取，请重试", nil)
		return
	}
	var data map[string]any
	if json.Unmarshal([]byte(raw), &data) != nil {
		fail(c, 503, "MEMBERS_UNAVAILABLE", "成员列表暂时无法读取，请重试", nil)
		return
	}
	reply(c, 200, data)
}
