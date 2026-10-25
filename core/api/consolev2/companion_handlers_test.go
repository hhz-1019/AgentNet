package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"image"
	"image/png"
	"os"
	"strings"
	"testing"
)

func TestElsewhereCompanionValidation(t *testing.T) {
	for _, name := range []string{"Codex", " ChatGPT ", "Claude-4", "GPT4", "豆包的助手", "Codex:小林", "Gemini Agent"} {
		if validCompanionName(name) {
			t.Fatal("tool name accepted", name)
		}
	}
	for _, name := range []string{"林间", "阿舟", "Moon"} {
		if !validCompanionName(name) {
			t.Fatal("personal name rejected", name)
		}
	}
	p := companionSettings{AgentName: "林间", ConnectionGoal: "认识愿意慢慢聊书的人", StartHour: 8, EndHour: 24}
	if !validCompanionSettings(p) {
		t.Fatal("valid goal rejected")
	}
	emptyGoal := p
	emptyGoal.ConnectionGoal = ""
	if !validCompanionSettings(emptyGoal) {
		t.Fatal("unknown owner needs must not block registration")
	}
	for _, hours := range [][2]int{{-1, 24}, {8, 8}, {9, 8}, {0, 25}} {
		p.StartHour, p.EndHour = hours[0], hours[1]
		if !validCompanionSettings(p) {
			t.Fatal("legacy hours must be ignored", hours)
		}
	}
}
func TestElsewhereCompanionLegacyRenamePreservesIdentity(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(88501,'Codex'),(88502,'阿舟'); INSERT INTO human_accounts VALUES('companion-owner','fixture','fixture',1),('companion-other','fixture','fixture',1); INSERT INTO agent_owners VALUES(88501,'companion-owner',1),(88502,'companion-other',1); INSERT INTO twin_users(user_id,created_at,last_active_at,portrait_fields) VALUES('companion-owner',1,1,'{"name":"小林","recent":"私人资料"}'),('companion-other',1,1,'{"name":"另一位"}'); INSERT INTO user_relations VALUES(88501,88502,1);`).Error)
	defer db.Exec(`DELETE FROM agent_network_goals WHERE agent_id IN(88501,88502); DELETE FROM agent_avatars WHERE agent_id IN(88501,88502); DELETE FROM agent_companions WHERE agent_id IN(88501,88502); DELETE FROM user_relations WHERE from_uid=88501; DELETE FROM twin_users WHERE user_id IN('companion-owner','companion-other'); DELETE FROM agent_owners WHERE agent_id IN(88501,88502); DELETE FROM human_accounts WHERE uid IN('companion-owner','companion-other'); DELETE FROM agents WHERE agent_id IN(88501,88502)`)
	s := &Service{db: db}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id := int64(88501)
		if c.Query("other") == "1" {
			id = 88502
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.GET("/companion", auth, s.getCompanion)
	h.PUT("/name", auth, s.renameLegacyCompanion)
	h.PUT("/companion", auth, s.putCompanion)
	h.POST("/avatar", auth, s.uploadAvatar)
	h.GET(avatarPrefix+":id", s.getCustomAvatar)
	h.PUT("/api/v2/console/portrait", auth, s.putPortrait)
	request := func(method, path string, body any) (int, map[string]any) {
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result()
		var out map[string]any
		_ = json.Unmarshal(r.Body(), &out)
		return r.StatusCode(), out
	}
	var raster bytes.Buffer
	if err := png.Encode(&raster, image.NewNRGBA(image.Rect(0, 0, 500, 300))); err != nil {
		t.Fatal(err)
	}
	uploadStatus, upload := request("POST", "/avatar", map[string]any{"data": base64.StdEncoding.EncodeToString(raster.Bytes())})
	if uploadStatus != 201 {
		t.Fatal(upload)
	}
	avatar := upload["data"].(map[string]any)["avatar"].(string)
	public := ut.PerformRequest(h.Engine, "GET", avatar, nil).Result()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(public.Body()))
	if public.StatusCode() != 200 || err != nil || format != "png" || cfg.Width != 256 || cfg.Height != 256 {
		t.Fatal("public avatar not served as sanitized raster")
	}
	statusSaved, saved := request("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 0, "fields": map[string]string{"avatar": avatar}})
	if statusSaved != 200 {
		t.Fatal("uploaded avatar could not be saved to the portrait", saved)
	}
	var storedAvatar string
	check(db.Raw("SELECT portrait_fields->>'avatar' FROM twin_users WHERE user_id='companion-owner'").Scan(&storedAvatar).Error)
	if storedAvatar != avatar {
		t.Fatal("saved portrait lost generated avatar", storedAvatar)
	}
	uploadStatus, upload = request("POST", "/avatar?other=1", map[string]any{"data": base64.StdEncoding.EncodeToString(raster.Bytes())})
	if uploadStatus != 201 {
		t.Fatal(upload)
	}
	foreign := upload["data"].(map[string]any)["avatar"].(string)
	statusForeign, _ := request("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 1, "fields": map[string]string{"avatar": foreign}})
	if statusForeign != 400 {
		t.Fatal("foreign avatar was attachable", statusForeign)
	}
	status, out := request("GET", "/companion", nil)
	if status != 200 {
		t.Fatal(out)
	}
	settings := out["data"].(map[string]any)["settings"].(map[string]any)
	if settings["owner_name"] != "小林" || settings["agent_name"] != "Codex" || settings["start_hour"] != float64(0) {
		t.Fatal("owner and agent identities mixed", settings)
	}
	status, out = request("PUT", "/name", map[string]any{"agent_name": "林间"})
	if status != 200 {
		t.Fatal(out)
	}
	status, _ = request("PUT", "/name", map[string]any{"agent_name": "林间"})
	if status != 200 {
		t.Fatal("lost receipt retry not idempotent")
	}
	status, _ = request("PUT", "/name", map[string]any{"agent_name": "别名"})
	if status != 409 {
		t.Fatal("personal name overwritten", status)
	}
	status, _ = request("PUT", "/name?other=1", map[string]any{"agent_name": "别名"})
	if status != 409 {
		t.Fatal("other personal name overwritten", status)
	}
	var count int
	check(db.Raw("SELECT count(*) FROM user_relations WHERE from_uid=88501 AND to_uid=88502").Scan(&count).Error)
	if count != 1 {
		t.Fatal("relationships lost")
	}
	var owner string
	check(db.Raw("SELECT portrait_fields->>'name' FROM twin_users WHERE user_id='companion-owner'").Scan(&owner).Error)
	if owner != "小林" {
		t.Fatal("owner nickname overwritten")
	}
	// Owner edits can choose a different personal name and retain opt-outs.
	p := companionSettings{AgentName: "松松", ConnectionGoal: "认识愿意一起散步的人", StartHour: 9, EndHour: 22, Revision: 1}
	status, out = request("PUT", "/companion", p)
	if status != 200 {
		t.Fatal(out)
	}
	status, _ = request("PUT", "/companion", p)
	if status != 409 {
		t.Fatal("stale save accepted")
	}
	status, out = request("GET", "/companion", nil)
	if status != 200 {
		t.Fatal(out)
	}
	settings = out["data"].(map[string]any)["settings"].(map[string]any)
	if settings["agent_name"] != "松松" || settings["connection_goal"] != p.ConnectionGoal || settings["history_images"] != false || settings["name_locked"] != true {
		t.Fatal("owner preferences not preserved", settings)
	}
	p.Revision = 2
	p.ConnectionGoal = ""
	status, out = request("PUT", "/companion", p)
	if status != 200 {
		t.Fatal("owner could not clear connection goal", out)
	}
	status, out = request("GET", "/companion", nil)
	if status != 200 || out["data"].(map[string]any)["settings"].(map[string]any)["connection_goal"] != "" {
		t.Fatal("cleared goal was restored from stale context", out)
	}

}
