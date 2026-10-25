package consolev2

import (
	"context"
	"strconv"
)

// Recruiters are ordinary database identities in the authenticated contacts list.
// This runs after the shared discovery cache, so blocks and archived accounts
// are checked against the current viewer rather than cached across viewers.
func (s *Service) appendRecruiterDiscovery(ctx context.Context, viewer int64, result *homeDiscoveryResponse) error {
	if result == nil {
		return nil
	}
	var rows []struct {
		AgentID                           int64
		ShortID, AgentName, Bio, Scenario string
		CreatedAt                         int64
		Discoverable                      bool
	}
	seeds := []int{10000, 10001, 10002, 10003, 10004}
	for _, p := range informationCatalog() {
		seeds = append(seeds, p.SeedIndex)
	}
	err := s.db.WithContext(ctx).Raw(`SELECT a.agent_id,COALESCE(a.short_id,'') AS short_id,a.agent_name,a.bio,a.created_at,m.scenario,
 (m.deleted_at=0 AND a.identity_state='active' AND o.state='completed'
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2
 AND ((b.from_uid=? AND b.to_uid=a.agent_id) OR (b.to_uid=? AND b.from_uid=a.agent_id)))) AS discoverable
 FROM managed_members m JOIN agents a USING(agent_id) JOIN agent_onboarding_v2 o USING(agent_id)
 WHERE m.seed_index IN ?
 ORDER BY m.seed_index,a.agent_id`, viewer, viewer, seeds).Scan(&rows).Error
	if err != nil {
		return err
	}
	items := make([]homeDiscoveryAgent, 0, len(rows)+len(result.Items))
	seen := map[string]bool{}
	for _, row := range rows {
		id := strconv.FormatInt(row.AgentID, 10)
		seen[id] = true
		if !row.Discoverable {
			continue
		}
		items = append(items, homeDiscoveryAgent{AgentID: id, ShortID: row.ShortID, SharePath: "/agent/" + id,
			AgentName: row.AgentName, AgentDescription: row.Bio, Capabilities: []string{row.Scenario}, JoinedAt: row.CreatedAt})
	}
	for _, item := range result.Items {
		if !seen[item.AgentID] {
			items = append(items, item)
			seen[item.AgentID] = true
		}
	}
	result.Items = items
	return nil
}
