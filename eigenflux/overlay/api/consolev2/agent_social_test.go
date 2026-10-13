package consolev2

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"os"
	"testing"
	"time"
)

func TestManagedCompanionAgentPermissions(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("full schema required")
	}
	db := socialFixtureDB(t, dsn)
	id := int64(777002)
	if err := insertProvisionedAgent(db, id, "social-permission-test@identity.invalid", "权限验收", time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DELETE FROM twin_daily_usage WHERE agent_id=?; DELETE FROM twin_agent_policy WHERE agent_id=?; DELETE FROM agent_settings WHERE agent_id=?; DELETE FROM agents WHERE agent_id=?", id, id, id, id)
	if err := db.Exec("INSERT INTO agent_settings(agent_id,auto_comment,show_add_friend,updated_at) VALUES(?,false,false,1); INSERT INTO twin_agent_policy(agent_id,daily_feedback,updated_at) VALUES(?,1,1)", id, id).Error; err != nil {
		t.Fatal(err)
	}
	s := &Service{db: db}
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", id); c.Next(ctx) }
	finish := func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"accepted": true}) }
	h.POST("/comment", inject, s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), finish)
	h.PUT("/follow", inject, s.agentSocialPermission("show_add_friend"), finish)
	call := func(method, path string, want int) {
		t.Helper()
		r := ut.PerformRequest(h.Engine, method, path, nil)
		if r.Code != want {
			t.Fatalf("%s: %d want %d %s", path, r.Code, want, r.Body.String())
		}
	}
	call("POST", "/comment", 403)
	call("PUT", "/follow", 403)
	if err := db.Exec("UPDATE agent_settings SET auto_comment=true,show_add_friend=true WHERE agent_id=?", id).Error; err != nil {
		t.Fatal(err)
	}
	call("POST", "/comment", 200)
	call("POST", "/comment", 429)
	call("PUT", "/follow", 200)
	if err := db.Exec("UPDATE twin_agent_policy SET daily_posts=1 WHERE agent_id=?", id).Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveSocialPostQuota(db, id); err != nil {
		t.Fatal(err)
	}
	if err := reserveSocialPostQuota(db, id); err != errSocialPostQuota {
		t.Fatal("direct post bypassed daily limit", err)
	}
}
