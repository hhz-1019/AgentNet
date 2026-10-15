package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestManagedCompanionContextUpgradeAndActionBoundaries(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("full schema required")
	}
	t.Setenv("HUMAN_AUTH_MODE", "uid")
	db := socialFixtureDB(t, dsn)
	id := int64(777009)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(insertProvisionedAgent(db, id, "permission-contract@identity.invalid", "小舟", time.Now().UnixMilli()))
	check(db.Exec(`INSERT INTO agent_settings(agent_id,recurring_publish,auto_comment,auto_reply_pm,auto_start_pm,auto_connect,show_add_friend,updated_at) VALUES(?,true,true,true,false,true,false,1)`, id).Error)
	check(db.Exec(`INSERT INTO agent_context_heads(agent_id,current_revision,active_revision,updated_at) VALUES(?,1,NULL,1)`, id).Error)
	check(db.Exec(`INSERT INTO agent_context_revisions(agent_id,revision,compiled_context,schema_version,generated_at) VALUES(?,1,'{"context_revision":1,"safety":{"external_side_effects":"require_user_confirmation"}}',1,1)`, id).Error)
	check(db.Exec(`UPDATE agent_context_heads SET active_revision=1 WHERE agent_id=?`, id).Error)
	check(db.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at,completed_at) VALUES(?,'completed',5,1,1,1,1,1)`, id).Error)
	s := &Service{db: db}
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", id); c.Next(ctx) }
	finish := func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"accepted": true}) }
	h.GET("/context", inject, s.getControlContext)
	h.PUT("/boundary", inject, s.putSecurityBoundary)
	h.POST("/comment", inject, s.agentSocialPermission("auto_comment"), finish)
	h.POST("/pm", inject, s.agentMessagePermission(), finish)
	h.POST("/follow", inject, s.agentSocialPermission("auto_connect"), finish)
	h.POST("/post", inject, s.agentSocialPermission("recurring_publish"), finish)
	call := func(method, path, body string, want int) map[string]any {
		t.Helper()
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(body), Len: len(body)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s %d: %s", path, r.Code, r.Body.String())
		}
		var v map[string]any
		check(json.Unmarshal(r.Body.Bytes(), &v))
		return v
	}
	v := call("GET", "/context?if_newer=1", "", 200)["data"].(map[string]any)
	if v["context_revision"] != float64(2) || v["unchanged"] != false {
		t.Fatal("legacy cache was not invalidated", v)
	}
	var active int64
	check(db.Raw("SELECT active_context_revision FROM agent_onboarding_v2 WHERE agent_id=?", id).Scan(&active).Error)
	if active != 2 {
		t.Fatal("onboarding pointer not refreshed", active)
	}
	safety := v["control_context"].(map[string]any)["safety"].(map[string]any)
	actions := safety["ordinary_social_actions"].(map[string]any)
	if safety["external_side_effects"] != "respect_action_permissions" || actions["comment"] != true || actions["start_pm"] != false || actions["follow"] != true || safety["owner_commitments"] != "require_user_confirmation" {
		t.Fatal(safety)
	}
	v = call("GET", "/context?if_newer=2", "", 200)["data"].(map[string]any)
	if v["unchanged"] != true || v["context_revision"] != float64(2) {
		t.Fatal("repeated read created another revision", v)
	}
	call("POST", "/comment", "{}", 200)
	call("POST", "/follow", "{}", 200) // hidden profile button is not a ban on following
	call("POST", "/post", "{}", 200)
	call("POST", "/pm", `{"receiver_id":"2","content":"你好"}`, 403)
	call("POST", "/pm", `{"conv_id":"3","content":"接着聊"}`, 200)
	check(updateSocialPermissions(db, id, nil, nil))
	var start bool
	check(db.Raw("SELECT auto_start_pm FROM agent_settings WHERE agent_id=?", id).Scan(&start).Error)
	if start {
		t.Fatal("older client erased owner opt-out")
	}

	call("PUT", "/boundary", `{"expected_context_revision":2,"idempotency_key":"new-client-permissions","recurring_publish":true,"auto_comment":true,"auto_reply_pm":true,"show_add_friend":false,"auto_start_pm":true,"auto_connect":false}`, 200)
	call("POST", "/pm", `{"receiver_id":"2","content":"你好"}`, 200)
	call("POST", "/follow", "{}", 403)
	call("PUT", "/boundary", `{"expected_context_revision":3,"idempotency_key":"old-client-preserve-permissions","recurring_publish":true,"auto_comment":true,"auto_reply_pm":true,"show_add_friend":true}`, 200)
	call("POST", "/pm", `{"receiver_id":"2","content":"你好"}`, 200)
	call("POST", "/follow", "{}", 403)
	check(db.Exec("UPDATE agent_settings SET auto_comment=false,recurring_publish=false,auto_reply_pm=false,auto_connect=false WHERE agent_id=?", id).Error)
	call("POST", "/comment", "{}", 403)
	call("POST", "/follow", "{}", 403)
	call("POST", "/post", "{}", 403)
	call("POST", "/pm", `{"conv_id":"3"}`, 403)
	// Managed/official identities retain the original context policy.
	check(db.Exec("UPDATE agents SET is_official=true WHERE agent_id=?", id).Error)
	legacy, err := compileSocialSafety(db, id)
	check(err)
	if legacy["external_side_effects"] != "require_user_confirmation" {
		t.Fatal("official policy changed", legacy)
	}
}
