package consolev2

import (
    "context"
    apidal "eigenflux_server/api/dal"
    "github.com/cloudwego/hertz/pkg/app"
)

// Owner sessions and Agent credentials reach the same existing settings row.
func (s *Service) getCommunityPreferences(_ context.Context, c *app.RequestContext) {
    id, _ := agentID(c)
    settings, err := apidal.GetSettings(s.db, id)
    if err != nil { fail(c, 503, "SETTINGS_UNAVAILABLE", "暂时无法读取官方推荐设置", nil); return }
    reply(c, 200, map[string]any{"official_pm_optout": settings.OfficialPMOptout})
}

func (s *Service) putCommunityPreferences(ctx context.Context, c *app.RequestContext) {
    var req struct { Optout *bool `json:"official_pm_optout"` }
    if decodeBody(c, &req) != nil || req.Optout == nil {
        fail(c, 400, "INVALID_REQUEST", "official_pm_optout 必须是布尔值", nil); return
    }
    id, _ := agentID(c)
    if err := apidal.UpdateAgentReportedSettings(s.db, id, nil, nil, nil, nil, nil, req.Optout); err != nil {
        fail(c, 503, "SETTINGS_UNAVAILABLE", "保存失败，请重试", nil); return
    }
    s.getCommunityPreferences(ctx, c)
}
