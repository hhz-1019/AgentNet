package consolev2

import (
	"context"
	"net/url"
	"os"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

func managedProvider() string {
	endpoint, ok := managedModelURL()
	if !ok {
		return ""
	}
	u, _ := url.Parse(endpoint)
	return u.Hostname()
}

func (s *Service) managedBeat(state string) {
	s.db.Exec(`INSERT INTO managed_worker_health(id,last_seen_at,state) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,state=EXCLUDED.state`, time.Now().UnixMilli(), state)
}

func (s *Service) managedOverview(owner string, payload map[string]any) error {
	templates := []managedPersona{}
	index := 0
	for _, count := range managedSceneCounts {
		templates = append(templates, managedRichPersona(index, "新角色"))
		index += count
	}
	payload["profile_templates"] = templates
	var sources []struct {
		FeedURL   string `json:"feed_url"`
		FetchedAt int64  `json:"fetched_at"`
		Status    string `json:"status"`
		ItemCount int    `json:"item_count"`
	}
	if err := s.db.Raw(`SELECT feed_url,fetched_at,status,jsonb_array_length(items) AS item_count FROM managed_source_cache ORDER BY feed_url`).Scan(&sources).Error; err != nil {
		return err
	}
	payload["sources"] = sources
	var health struct {
		LastSeenAt int64  `json:"last_seen_at"`
		State      string `json:"state"`
	}
	if err := s.db.Raw(`SELECT last_seen_at,state FROM managed_worker_health WHERE id=1`).Scan(&health).Error; err != nil {
		return err
	}
	payload["runtime"] = map[string]any{"last_seen_at": health.LastSeenAt, "state": health.State, "healthy": health.State == "ready" && health.LastSeenAt > time.Now().Add(-2*time.Minute).UnixMilli()}
	var usage struct {
		SettledFen         int64 `json:"settled_fen"`
		ReservedFen        int64 `json:"reserved_fen"`
		InputTokens        int64 `json:"input_tokens"`
		OutputTokens       int64 `json:"output_tokens"`
		Published          int64 `json:"published"`
		Commented          int64 `json:"commented"`
		Skipped            int64 `json:"skipped"`
		Failed             int64 `json:"failed"`
		SuccessfulAccounts int64 `json:"successful_accounts"`
	}
	month := time.Now().UTC().Add(8 * time.Hour).Format("2006-01")
	if err := s.db.Raw(`SELECT COALESCE(sum(charged_fen) FILTER(WHERE status IN ('published','commented','skipped')),0) AS settled_fen,
 COALESCE(sum(charged_fen) FILTER(WHERE status IN ('running','failed','uncertain')),0) AS reserved_fen,
 COALESCE(sum(input_tokens),0) AS input_tokens,COALESCE(sum(output_tokens),0) AS output_tokens,
 count(*) FILTER(WHERE status='published') AS published,count(*) FILTER(WHERE status='commented') AS commented,
 count(*) FILTER(WHERE status='skipped') AS skipped,count(*) FILTER(WHERE status IN ('failed','uncertain')) AS failed,
 count(DISTINCT agent_id) FILTER(WHERE status IN ('published','commented')) AS successful_accounts
 FROM managed_runs WHERE sponsor_uid=? AND month=?`, owner, month).Scan(&usage).Error; err != nil {
		return err
	}
	payload["billing"] = map[string]any{"source": "platform_shared", "sponsor_number": payload["sponsor_number"], "provider_host": managedProvider(), "model": os.Getenv("LLM_MODEL"), "month": month, "usage": usage}
	return nil
}

// Call under the same advisory lock used by the scheduler; queueing cannot
// promise execution while the budget, hours, or daily policy reject the task.
func managedQueueBlock(tx *gorm.DB, owner string, id int64, now time.Time) (string, error) {
	var member struct {
		AgentID                        int64
		Enabled                        bool
		DailyLimit, StartHour, EndHour int
	}
	if err := tx.Raw(`SELECT agent_id,enabled,daily_limit,start_hour,end_hour FROM managed_members WHERE agent_id=? AND sponsor_uid=?`, id, owner).Scan(&member).Error; err != nil {
		return "", err
	}
	if member.AgentID == 0 {
		return "", errUnauthorized
	}
	var campaign managedCampaign
	if err := tx.Raw(`SELECT * FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE`, owner).Scan(&campaign).Error; err != nil {
		return "", err
	}
	if !member.Enabled {
		return "此角色已暂停，请先启用", nil
	}
	if !campaign.Enabled {
		return "全部活动已暂停，请先在预算与调度中开启", nil
	}
	local := now.UTC().Add(8 * time.Hour)
	if local.Hour() < member.StartHour || local.Hour() >= member.EndHour {
		return "当前不在该角色的北京时间活动时段内", nil
	}
	var counts struct{ Today, Running int64 }
	if err := tx.Raw(`SELECT count(*) FILTER(WHERE day=?::date) AS today,count(*) FILTER(WHERE status='running') AS running FROM managed_runs WHERE agent_id=?`, local.Format("2006-01-02"), id).Scan(&counts).Error; err != nil {
		return "", err
	}
	if counts.Running > 0 {
		return "该角色已有活动正在执行，请等待回执", nil
	}
	if counts.Today >= int64(member.DailyLimit) {
		return "已达到今日尝试上限，可修改上限或明日再安排", nil
	}
	var spent int64
	if err := tx.Raw(`SELECT COALESCE(sum(charged_fen),0) FROM managed_runs WHERE sponsor_uid=? AND month=?`, owner, local.Format("2006-01")).Scan(&spent).Error; err != nil {
		return "", err
	}
	reserve := managedCost(managedMaxInput, managedMaxOutput, campaign.InputFenPerMillion, campaign.OutputFenPerMillion)
	if campaign.InputFenPerMillion <= 0 || campaign.OutputFenPerMillion <= 0 || reserve <= 0 || spent+reserve > campaign.MonthlyBudgetFen {
		return "本月剩余额度不足以预留一次调用，请调整预算", nil
	}
	return "", nil
}

func (s *Service) returnManagedOperator(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	source, _ := c.Get("console_session_id")
	var session uidSession
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var id int64
		if err := tx.Raw(`SELECT o.agent_id FROM agent_owners o JOIN agents a USING(agent_id) WHERE o.owner_uid=? AND a.identity_state='active' ORDER BY o.created_at LIMIT 1`, owner).Scan(&id).Error; err != nil {
			return err
		}
		if id == 0 {
			return errUnauthorized
		}
		var err error
		session, err = s.newUIDSession(tx, c, owner, id, time.Now().UnixMilli())
		if err != nil {
			return err
		}
		if err = tx.Exec(`UPDATE console_v2_sessions SET status='revoked',revoked_at=? WHERE session_id=? AND EXISTS(SELECT 1 FROM managed_delegations d WHERE d.session_id=console_v2_sessions.session_id AND d.sponsor_uid=?)`, time.Now().UnixMilli(), source, owner).Error; err != nil {
			return err
		}
		return managedAudit(tx, owner, "return_operator", id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	s.issueUIDSession(c, session)
	reply(c, 200, map[string]any{"returned": true})
}

func (s *Service) revokeManagedSessions(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var revoked int64
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var exists bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_members WHERE agent_id=? AND sponsor_uid=?)`, id, owner).Scan(&exists).Error; err != nil {
			return err
		}
		if !exists {
			return errUnauthorized
		}
		r := tx.Exec(`UPDATE console_v2_sessions SET status='revoked',revoked_at=? WHERE agent_id=? AND status='active' AND session_id IN (SELECT session_id FROM managed_delegations WHERE sponsor_uid=?)`, time.Now().UnixMilli(), id, owner)
		if r.Error != nil {
			return r.Error
		}
		revoked = r.RowsAffected
		return managedAudit(tx, owner, "revoke_sessions", id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"revoked": revoked})
}
