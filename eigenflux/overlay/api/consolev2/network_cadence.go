package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

var errNetworkCadence = errors.New("activity cadence not due")
var errNetworkQuota = errors.New("daily activity quota reached")

// The owner sets a minimum interval, not a promise to wake an offline host.
// A single atomic admission prevents two Agent runtimes from doubling activity.
func admitNetworkCadence(tx *gorm.DB, id int64, activity string, interval int64, key string) error {
	if interval == 0 {
		return errNetworkCadence
	}
	var admitted int64
	now := time.Now().UnixMilli()
	e := tx.Raw(`INSERT INTO twin_activity_cadence(agent_id,activity,admitted_at,request_key) VALUES(?,?,?,?) ON CONFLICT(agent_id,activity) DO UPDATE SET admitted_at=CASE WHEN twin_activity_cadence.request_key<>'' AND twin_activity_cadence.request_key=EXCLUDED.request_key THEN twin_activity_cadence.admitted_at ELSE EXCLUDED.admitted_at END,request_key=EXCLUDED.request_key WHERE twin_activity_cadence.admitted_at<=? OR (twin_activity_cadence.request_key<>'' AND twin_activity_cadence.request_key=EXCLUDED.request_key) RETURNING admitted_at`, id, activity, now, key, now-interval).Scan(&admitted).Error
	if e != nil {
		return e
	}
	if admitted == 0 {
		return errNetworkCadence
	}
	return nil
}
func (s *Service) networkReportAdmission(ctx context.Context, c *app.RequestContext, id int64) {
	var req attentionPublishRequest
	body, _ := c.Body()
	if json.Unmarshal(body, &req) != nil || validateAttentionPublish(&req, time.Now().UnixMilli()) != nil {
		// Leave protocol validation and its detailed error contract to the handler.
		c.Next(ctx)
		return
	}
	focus := false
	for _, item := range req.Items {
		if item.Surface == "focus" {
			focus = true
		}
	}
	if !focus {
		c.Next(ctx)
		return
	} // Owner decisions remain available while reports are paused.
	var row struct {
		ReportIntervalHours int
		Revision            int64
	}
	if e := s.db.WithContext(ctx).Raw(`SELECT report_interval_hours,revision FROM twin_agent_policy WHERE agent_id=?`, id).Scan(&row).Error; e != nil {
		fail(c, 503, "ACTIVITY_UNAVAILABLE", "报告节奏暂时无法核对", nil)
		c.Abort()
		return
	}
	if row.Revision == 0 {
		c.Next(ctx)
		return
	}
	if e := admitNetworkCadence(s.db.WithContext(ctx), id, "report", int64(row.ReportIntervalHours)*3600000, req.IdempotencyKey); e != nil {
		if errors.Is(e, errNetworkCadence) {
			fail(c, 429, "REPORT_NOT_DUE", "尚未到定期报告时间；待决定事项请单独提交", nil)
		} else {
			fail(c, 503, "ACTIVITY_UNAVAILABLE", "报告节奏暂时无法核对", nil)
		}
		c.Abort()
		return
	}
	c.Next(ctx)
}
