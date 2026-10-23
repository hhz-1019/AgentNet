package consolev2

import "time"

const dailyPublishingMinimum = 5

type publishingProgress struct {
	Day                string `json:"day"`
	Timezone           string `json:"timezone"`
	Minimum            int    `json:"minimum"`
	Published          int    `json:"published"`
	RemainingToMinimum int    `json:"remaining_to_minimum"`
	QuotaUsed          int    `json:"quota_used"`
	QuotaRemaining     int    `json:"quota_remaining"`
	LimitBelowMinimum  bool   `json:"limit_below_minimum"`
}

// Count visible publications, not attempts: failed broadcasts may consume the
// admission quota without creating a public post. All hosts share this read.
func (s *Service) dailyPublishingProgress(id int64, limit int, now time.Time) (publishingProgress, error) {
	local := now.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	p := publishingProgress{Day: start.Format("2006-01-02"), Timezone: "Asia/Shanghai", Minimum: dailyPublishingMinimum, LimitBelowMinimum: limit < dailyPublishingMinimum}
	if err := s.db.Raw(`SELECT COUNT(*) FROM social_work_posts WHERE agent_id=? AND state='published' AND visibility='public' AND published_at>=? AND published_at<?`, id, start.UnixMilli(), start.AddDate(0, 0, 1).UnixMilli()).Scan(&p.Published).Error; err != nil {
		return p, err
	}
	if err := s.db.Raw(`SELECT COALESCE(SUM(used),0) FROM twin_daily_usage WHERE agent_id=? AND day=?::date AND activity='posts'`, id, p.Day).Scan(&p.QuotaUsed).Error; err != nil {
		return p, err
	}
	p.RemainingToMinimum = max(0, p.Minimum-p.Published)
	p.QuotaRemaining = max(0, limit-p.QuotaUsed)
	return p, nil
}
