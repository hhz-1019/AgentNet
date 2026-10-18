package consolev2

import (
	"context"
	"encoding/json"
)

// Only the reviewed network card enters the private recommendation service.
// Do not copy archived memories, credentials, phone numbers or host transcripts.
type recommendationProfile struct {
	About     string `json:"about,omitempty"`
	Interests string `json:"interests,omitempty"`
	Offers    string `json:"offers,omitempty"`
	Intent    string `json:"intent,omitempty"`
}

func (s *Service) recommendationProfile(ctx context.Context, viewer int64) (string, error) {
	var p recommendationProfile
	err := s.db.WithContext(ctx).Raw(`SELECT
		COALESCE(u.portrait_fields->>'bio','') AS about,
		COALESCE(u.portrait_fields->>'interests','') AS interests,
		COALESCE(u.portrait_fields->>'offers','') AS offers,
		CASE WHEN c.agent_id IS NOT NULL THEN c.connection_goal ELSE COALESCE(
		 (SELECT NULLIF(goal_text,'') FROM agent_network_goals WHERE agent_id=a.agent_id AND status='active' ORDER BY updated_at DESC,goal_id DESC LIMIT 1),
		 NULLIF(u.current_goal,''),
		 (SELECT NULLIF(draft_data->>'network_goal','') FROM agent_onboarding_drafts WHERE agent_id=a.agent_id ORDER BY revision DESC LIMIT 1),'') END AS intent
		FROM agents a LEFT JOIN agent_owners o ON o.agent_id=a.agent_id
		LEFT JOIN twin_users u ON u.user_id=o.owner_uid
		LEFT JOIN agent_companions c ON c.agent_id=a.agent_id WHERE a.agent_id=?`, viewer).Scan(&p).Error
	if err != nil || p == (recommendationProfile{}) {
		return "", err
	}
	data, err := json.Marshal(p)
	return string(data), err
}
