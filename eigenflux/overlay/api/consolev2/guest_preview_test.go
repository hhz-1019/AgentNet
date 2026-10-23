package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestElsewhereGuestPreviewAccess(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated social PostgreSQL fixture")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name,identity_state) VALUES(88001,'公开访客测试','active'),(88002,'已归档','managed_archived')`).Error)
	defer db.Exec(`DELETE FROM agents WHERE agent_id IN (88001,88002)`)
	check(db.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(88101,88001,decode('010203','hex'),'image/png',1),(88102,88001,decode('040506','hex'),'image/png',1),(88103,88002,decode('070809','hex'),'image/png',1)`).Error)
	insert := func(id, agent int, visibility, state string, media int) {
		d := socialTestDocument()
		d.Summary = strings.Repeat("预览", 100)
		d.Body = "正文不应出现在访客接口"
		d.Media = []socialMedia{{URL: fmt.Sprintf("%s%d", socialMediaPrefix, media), Kind: "image", Alt: "封面"}, {URL: socialMediaPrefix + "88102", Kind: "image", Alt: "内页"}}
		b, _ := json.Marshal(d)
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,?, ?,?::jsonb,1,1,1)`, id, agent, state, visibility, string(b)).Error)
	}
	insert(88201, 88001, "public", "published", 88101)
	insert(88202, 88001, "friends", "published", 88102)
	insert(88203, 88001, "private", "published", 88102)
	insert(88204, 88001, "public", "draft", 88102)
	insert(88205, 88002, "public", "published", 88103)
	defer db.Exec(`DELETE FROM social_work_posts WHERE agent_id IN (88001,88002)`)
	defer db.Exec(`DELETE FROM social_media WHERE agent_id IN (88001,88002)`)
	h := server.New()
	s := &Service{db: db}
	h.GET("/feed", s.getGuestFeed)
	h.GET("/avatars", s.getAvatars)
	h.GET("/posts/:post_id/cover", s.getGuestCover)
	h.GET("/posts/:post_id", s.getGuestPost)
	h.GET("/posts/:post_id/comments", s.getGuestComments)
	h.GET("/posts/:post_id/media/:index", s.getGuestMedia)
	h.GET("/people", s.getGuestPeople)
	h.GET("/people/:person_id", s.getGuestPerson)
	get := func(path string, status int) []byte {
		t.Helper()
		r := ut.PerformRequest(h.Engine, http.MethodGet, path, nil).Result()
		if r.StatusCode() != status {
			t.Fatalf("%s: %d %s", path, r.StatusCode(), r.Body())
		}
		return r.Body()
	}
	response := ut.PerformRequest(h.Engine, http.MethodGet, "/feed", nil).Result()
	if response.StatusCode() != 200 {
		t.Fatal(string(response.Body()))
	}
	var result struct {
		Data struct {
			Items []guestPost `json:"items"`
		} `json:"data"`
	}
	check(json.Unmarshal(response.Body(), &result))
	found := false
	for _, p := range result.Data.Items {
		if p.ID == "88201" {
			found = true
			if len([]rune(p.Excerpt)) != 91 || p.Cover != "/api/v2/guest/posts/88201/media/0" || p.AuthorName != "公开访客测试" || p.Document.Body != "" {
				t.Fatalf("bad preview: %+v", p)
			}
		}
		if p.ID == "88202" || p.ID == "88203" || p.ID == "88204" || p.ID == "88205" {
			t.Fatal("non-public post exposed", p.ID)
		}
	}
	if !found || strings.Contains(string(response.Body()), "正文不应") || strings.Contains(string(response.Body()), "内部来源") {
		t.Fatal("invalid public projection", string(response.Body()))
	}
	for _, id := range []string{"88202", "88203", "88204", "88205", "999999", "bad"} {
		get("/posts/"+id, 404)
		get("/posts/"+id+"/comments", 404)
		get("/posts/"+id+"/media/1", 404)
		if r := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/"+id+"/cover", nil).Result(); r.StatusCode() != 404 {
			t.Fatal("private cover accessible", id, r.StatusCode())
		}
	}
	cover := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/88201/cover", nil).Result()
	if cover.StatusCode() != 200 || string(cover.Body()) != "\x01\x02\x03" || string(cover.Header.Peek("Cache-Control")) != "private, no-cache" {
		t.Fatal("public cover mismatch")
	}
	detail := string(get("/posts/88201", 200))
	if !strings.Contains(detail, "正文不应") || strings.Contains(detail, "内部来源") || strings.Contains(detail, "复现步骤与验证边界") {
		t.Fatal("incorrect public detail projection", detail)
	}
	if string(get("/posts/88201/media/1", 200)) != "\x04\x05\x06" {
		t.Fatal("second image unavailable")
	}
	get("/posts/88201/media/4", 404)
	get("/posts/88201/media/bad", 404)
	check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) SELECT n,88201,88001,'公开评论','guest-'||n,1 FROM generate_series(88300,88350) n`).Error)
	check(db.Exec(`INSERT INTO social_work_comments VALUES(88399,88201,88002,'已归档评论','archived-guest',1)`).Error)
	comments := get("/posts/88201/comments", 200)
	if strings.Contains(string(comments), "已归档评论") {
		t.Fatal("archived comment exposed")
	}
	var page struct {
		Data struct {
			Items []map[string]any `json:"items"`
			Next  string           `json:"next_cursor"`
		} `json:"data"`
	}
	check(json.Unmarshal(comments, &page))
	if len(page.Data.Items) != 50 || page.Data.Next == "" {
		t.Fatal("comment pagination missing")
	}
	check(json.Unmarshal(get("/posts/88201/comments?cursor="+page.Data.Next, 200), &page))
	if len(page.Data.Items) != 1 || page.Data.Next != "" {
		t.Fatal("comment pagination duplicated or omitted rows")
	}
	// Public profiles honor owner-selected fields and never expose private memories.
	check(db.Exec(`INSERT INTO human_accounts VALUES('guest-owner','fixture','fixture',1); INSERT INTO agent_owners VALUES(88001,'guest-owner',1); INSERT INTO twin_users(user_id,created_at,last_active_at,portrait_fields,portrait_visible) VALUES('guest-owner',1,1,'{"name":"公开昵称","bio":"私密介绍","interests":"公开兴趣","role":"私人身份","avatar":"tide"}','["name","interests"]')`).Error)
	defer db.Exec(`DELETE FROM twin_users WHERE user_id='guest-owner';DELETE FROM agent_owners WHERE owner_uid='guest-owner';DELETE FROM human_accounts WHERE uid='guest-owner'`)
	avatars := string(get("/avatars?ids=88001,88002,999999", 200))
	if !strings.Contains(avatars, `"88001":"tide"`) || strings.Contains(avatars, "88002") || strings.Contains(avatars, "guest-owner") || strings.Contains(avatars, "私密介绍") {
		t.Fatal("invalid anonymous avatar projection", avatars)
	}
	check(db.Exec(`UPDATE agents SET is_official=true WHERE agent_id=88001`).Error)
	if !strings.Contains(string(get("/avatars?ids=88001", 200)), officialAvatar) || !strings.Contains(string(get("/posts/88201", 200)), officialAvatar) {
		t.Fatal("official logo missing from avatar lookup or post")
	}
	check(db.Exec(`UPDATE agents SET is_official=false WHERE agent_id=88001`).Error)
	check(db.Exec(`UPDATE agents SET identity_state='managed_archived' WHERE agent_id=88001`).Error)
	if strings.Contains(string(get("/avatars?ids=88001", 200)), "tide") {
		t.Fatal("archived avatar exposed")
	}
	check(db.Exec(`UPDATE agents SET identity_state='active' WHERE agent_id=88001`).Error)
	get("/avatars?ids=invalid", 400)
	get("/avatars?ids="+strings.Repeat("88001,", 100)+"88001", 400)
	avatarID := strings.Repeat("b", 32)
	avatarPath := avatarPrefix + avatarID
	check(db.Exec(`INSERT INTO agent_avatars(avatar_id,agent_id,content,created_at) VALUES(?,88001,decode(?,'base64'),1)`, avatarID, base64.StdEncoding.EncodeToString(previewTestImage(t, 256, 256))).Error)
	defer db.Exec(`DELETE FROM agent_avatars WHERE avatar_id=?`, avatarID)
	for {
		worked, err := s.prepareNextMedia(context.Background())
		check(err)
		if !worked {
			break
		}
	}
	check(db.Exec(`UPDATE twin_users SET portrait_fields=jsonb_set(portrait_fields,'{avatar}',to_jsonb(?::text)) WHERE user_id='guest-owner'`, avatarPath).Error)
	withPreview := string(get("/avatars?ids=88001,88002", 200))
	if !strings.Contains(withPreview, `"color":"#2878b4"`) || !strings.Contains(withPreview, `data:image/jpeg;base64,`) || !strings.Contains(withPreview, avatarPath) || strings.Contains(withPreview, "88002") {
		t.Fatal("public avatar missing matching tiny preview", withPreview)
	}
	check(db.Exec(`UPDATE agents SET identity_state='managed_archived' WHERE agent_id=88001`).Error)
	if strings.Contains(string(get("/avatars?ids=88001", 200)), "base64") {
		t.Fatal("cached preview leaked archived identity")
	}
	check(db.Exec(`UPDATE agents SET identity_state='active' WHERE agent_id=88001`).Error)
	check(db.Exec(`UPDATE twin_users SET portrait_fields=jsonb_set(portrait_fields,'{avatar}','"tide"') WHERE user_id='guest-owner'`).Error)
	profile := string(get("/people/88001", 200))
	if !strings.Contains(profile, "公开兴趣") || strings.Contains(profile, "私密介绍") || strings.Contains(profile, "私人身份") || strings.Contains(profile, "guest-owner") {
		t.Fatal("profile visibility not respected", profile)
	}
	get("/people/88002", 404)
	people := string(get("/people", 200))
	if !strings.Contains(people, "公开访客测试") || strings.Contains(people, "已归档") {
		t.Fatal("invalid discovery projection", people)
	}
	for i := 0; i < 28; i++ {
		insert(88400+i, 88001, "public", "published", 88101)
	}
	check(db.Exec(`UPDATE social_work_posts SET document=jsonb_set(document,'{title}',to_jsonb('guest-pagination-'||post_id)) WHERE post_id BETWEEN 88400 AND 88427`).Error)
	for _, scope := range []string{"latest", "recommended"} {
		check(json.Unmarshal(get("/feed?q=guest-pagination&scope="+scope, 200), &page))
		if len(page.Data.Items) != 24 || page.Data.Next == "" {
			t.Fatal("feed first page invalid")
		}
		seen := map[string]bool{}
		for _, item := range page.Data.Items {
			seen[item["id"].(string)] = true
		}
		check(json.Unmarshal(get("/feed?q=guest-pagination&scope="+scope+"&cursor="+page.Data.Next, 200), &page))
		if len(page.Data.Items) != 4 || page.Data.Next != "" {
			t.Fatal("feed next page invalid")
		}
		for _, item := range page.Data.Items {
			if seen[item["id"].(string)] {
				t.Fatal("duplicate post across pages")
			}
		}
	}
	check(json.Unmarshal(get("/feed?q=guest-pagination&scope=recommended", 200), &page))
	excluded := []string{}
	for _, item := range page.Data.Items {
		excluded = append(excluded, item["id"].(string))
	}
	rawExcluded, _ := json.Marshal(excluded)
	check(json.Unmarshal(get("/feed?q=guest-pagination&scope=recommended&exclude_ids="+url.QueryEscape(string(rawExcluded)), 200), &page))
	if len(page.Data.Items) != 4 {
		t.Fatal("recommendation refresh did not replace the batch", page)
	}
	for _, item := range page.Data.Items {
		for _, id := range excluded {
			if item["id"] == id {
				t.Fatal("refresh repeated excluded post", id)
			}
		}
	}
	for _, raw := range []string{`[42]`, `["bad"]`, `["0"]`} {
		get("/feed?scope=recommended&exclude_ids="+url.QueryEscape(raw), 400)
	}
	for _, path := range []string{"/feed?cursor=bad", "/feed?author=bad", "/feed?scope=friends", "/people?cursor=bad", "/posts/88201/comments?cursor=bad"} {
		get(path, 400)
	}
	check(json.Unmarshal(get("/feed?q=guest-pagination&author=88002", 200), &page))
	if len(page.Data.Items) != 0 {
		t.Fatal("author filter ignored")
	}
	check(json.Unmarshal(get("/feed?tag=not-a-public-tag", 200), &page))
	if len(page.Data.Items) != 0 {
		t.Fatal("tag filter ignored")
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='friends' WHERE post_id=88201`).Error)
	get("/posts/88201", 404)
	get("/posts/88201/comments", 404)
	get("/posts/88201/media/1", 404)
	if r := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/88201/cover", nil).Result(); r.StatusCode() != 404 {
		t.Fatal("scope revocation ignored")
	}
}

func TestElsewherePeopleNameSearch(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated social PostgreSQL fixture")
	}
	db := socialFixtureDB(t, dsn)
	if err := db.Exec(`INSERT INTO agents(agent_id,agent_name,identity_state) SELECT n,'名字搜索_'||n,'active' FROM generate_series(89000,89026) n`).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Exec(`DELETE FROM agents WHERE agent_id BETWEEN 89000 AND 89029`)
	if err := db.Exec(`INSERT INTO agents(agent_id,agent_name,identity_state) VALUES (89027,'名字搜索_归档','managed_archived'),(89028,'名字搜索X其他','active'),(89029,'百分%Agent','active')`).Error; err != nil {
		t.Fatal(err)
	}
	h := server.New()
	s := &Service{db: db}
	h.GET("/people", s.getGuestPeople)
	read := func(path string) struct {
		Items []guestPerson `json:"items"`
		Next  string        `json:"next_cursor"`
	} { t.Helper(); r := ut.PerformRequest(h.Engine, http.MethodGet, path, nil).Result(); if r.StatusCode() != 200 {
		t.Fatalf("search failed: %d %s", r.StatusCode(), r.Body())
	}; var result struct {
		Data struct {
			Items []guestPerson `json:"items"`
			Next  string        `json:"next_cursor"`
		} `json:"data"`
	}; if err := json.Unmarshal(r.Body(), &result); err != nil {
		t.Fatal(err)
	}; return result.Data }
	first := read("/people?q=名字搜索_")
	if len(first.Items) != 24 || first.Next == "" {
		t.Fatal("active users without posts must be searchable and paginated", first)
	}
	seen := map[string]bool{}
	for _, p := range first.Items {
		if p.Posts != 0 || !strings.HasPrefix(p.Name, "名字搜索_") || p.ID == "89027" {
			t.Fatal("incorrect search projection", p)
		}
		seen[p.ID] = true
	}
	second := read("/people?q=名字搜索_&cursor=" + first.Next)
	if len(second.Items) != 3 || second.Next != "" {
		t.Fatal("incorrect final search page", second)
	}
	for _, p := range second.Items {
		if seen[p.ID] {
			t.Fatal("duplicate person", p)
		}
	}
	literal := read("/people?q=%25aGeNt")
	if len(literal.Items) != 1 || literal.Items[0].ID != "89029" {
		t.Fatal("search must be case insensitive and escape SQL wildcards", literal)
	}
	if len(read("/people?q=没有这个名字").Items) != 0 {
		t.Fatal("unmatched search should be empty")
	}
	if r := ut.PerformRequest(h.Engine, http.MethodGet, "/people?q="+strings.Repeat("字", 101), nil).Result(); r.StatusCode() != 400 {
		t.Fatal("unbounded search accepted")
	}
}
