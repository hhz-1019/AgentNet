package consolev2

import (
	"context"
	"encoding/json"
	"time"
)

// Counts come from the complete ledger, never the last 50 receipts in the UI.
const managedDailySummarySQL = `SELECT json_build_object(
 'attempts',count(*),'active_accounts',count(DISTINCT agent_id),
 'published',count(*) FILTER(WHERE status='published'),
 'commented',count(*) FILTER(WHERE status='commented'),
 'liked',count(*) FILTER(WHERE status='liked'),
 'skipped',count(*) FILTER(WHERE status='skipped'),
 'failed',count(*) FILTER(WHERE status IN ('failed','uncertain')),
 'running',count(*) FILTER(WHERE status='running'),
 'charged_fen',COALESCE(sum(charged_fen),0),
 'errors',COALESCE((SELECT json_agg(e) FROM (
 SELECT m.name,r.status,r.detail,r.created_at FROM managed_runs r JOIN managed_members m USING(agent_id)
 WHERE r.sponsor_uid=? AND r.day=?::date AND r.status IN ('failed','uncertain')
 ORDER BY r.created_at DESC LIMIT 20)e),'[]'::json))::text
 FROM managed_runs WHERE sponsor_uid=? AND day=?::date`

func (s *Service) managedDailySummary(ctx context.Context, owner, day string) (json.RawMessage, error) {
	var raw string
	err := s.db.WithContext(ctx).Raw(managedDailySummarySQL, owner, day, owner, day).Scan(&raw).Error
	return json.RawMessage(raw), err
}

// Run independently of model availability, campaign pause and paid requests.
// Allow ten minutes after midnight for in-flight work to settle; recover missed days.
func (s *Service) persistManagedDaily(ctx context.Context, now time.Time) error {
	local := now.UTC().Add(8 * time.Hour)
	if local.Hour() == 0 && local.Minute() < 10 {
		return nil
	}
	var missing []struct{ SponsorUID, Day string }
	err := s.db.WithContext(ctx).Raw(`SELECT c.sponsor_uid,to_char(d,'YYYY-MM-DD') AS day
 FROM managed_campaigns c CROSS JOIN generate_series(?::date-7,?::date-1,'1 day') d
 WHERE EXISTS(SELECT 1 FROM managed_runs r WHERE r.sponsor_uid=c.sponsor_uid AND r.day<=d::date)
 AND NOT EXISTS(SELECT 1 FROM managed_daily_reports r WHERE r.sponsor_uid=c.sponsor_uid AND r.day=d::date)
 ORDER BY d`, local.Format("2006-01-02"), local.Format("2006-01-02")).Scan(&missing).Error
	if err != nil {
		return err
	}
	for _, row := range missing {
		summary, err := s.managedDailySummary(ctx, row.SponsorUID, row.Day)
		if err != nil {
			return err
		}
		if err = s.db.WithContext(ctx).Exec(`INSERT INTO managed_daily_reports(sponsor_uid,day,summary,generated_at) VALUES(?,?::date,?::jsonb,?) ON CONFLICT DO NOTHING`, row.SponsorUID, row.Day, string(summary), now.UnixMilli()).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) managedDailyFeedback(owner string, payload map[string]any) error {
	ctx := context.Background()
	now := time.Now()
	day := now.UTC().Add(8 * time.Hour).Format("2006-01-02")
	today, err := s.managedDailySummary(ctx, owner, day)
	if err != nil {
		return err
	}
	var raw string
	err = s.db.Raw(`SELECT COALESCE(json_agg(r),'[]'::json)::text FROM (SELECT day::text,summary,generated_at FROM managed_daily_reports WHERE sponsor_uid=? ORDER BY day DESC LIMIT 7)r`, owner).Scan(&raw).Error
	if err != nil {
		return err
	}
	payload["daily_feedback"] = map[string]any{"day": day, "today": today, "reports": json.RawMessage(raw)}
	return nil
}
