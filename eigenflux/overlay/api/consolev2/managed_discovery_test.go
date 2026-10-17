package consolev2

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestManagedOwnerDiscoveryAndInteraction(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	t.Cleanup(func() { db.Rollback() })
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	for id := int64(93001); id <= 93008; id++ {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@discovery.invalid", "检索验收", now))
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES
 ('discovery',987654321,'!x','!x',1),('discovery-a',987654322,'!x','!x',1),('discovery-b',987654323,'!x','!x',1),
 ('discovery-owner',987654324,'!x','!x',1),('discovery-other',987654325,'!x','!x',1),('discovery-c',987654326,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('discovery',true,10000,1,1),('discovery-other',true,10000,1,1);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled) VALUES
 (93001,'discovery-a','discovery',0,'甲','植物养护','测试',true),(93002,'discovery-b','discovery',1,'乙','植物养护','测试',true),
 (93008,'discovery-c','discovery-other',0,'丙','植物养护','测试',true);
 INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(93003,'discovery-owner',1),(93004,'discovery-owner',1),(93005,'discovery-owner',1),(93006,'discovery-owner',1);
 UPDATE agents SET identity_state='recovered_temporary' WHERE agent_id=93005;
 INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(93006,93001,2,1);`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654321")
	s := &Service{db: db, idgen: &managedTestIDs{id: 93900000}}
	job := managedJob{AgentID: 93001, SponsorUID: "discovery", Scenario: "植物养护", Topic: "植物", Revision: 1, InputRate: 1, OutputRate: 1, Reserved: 10, RunID: 938000}
	for _, p := range []struct {
		id, author               int64
		state, visibility, title string
	}{
		{93101, 93003, "published", "public", "植物阳台的番茄开花了"},
		{93102, 93004, "published", "public", "城市铁路时刻查询"},
		{93103, 93003, "published", "private", "植物私人笔记"},
		{93104, 93003, "draft", "public", "植物草稿"},
		{93105, 93005, "published", "public", "植物旧账号"},
		{93106, 93006, "published", "public", "植物屏蔽账号"},
		{93107, 93007, "published", "public", "植物未绑定账号"},
		{93108, 93008, "published", "public", "植物其他运营角色"},
	} {
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision)
 VALUES(?,?,?,1,?,jsonb_build_object('title',?::text,'body','阳台上的番茄长出了三朵黄色的小花。','tags',jsonb_build_array()),?,?,1)`, p.id, p.author, p.state, p.visibility, p.title, now, now).Error)
	}
	ctx := context.Background()
	input, err := s.managedContext(ctx, job)
	check(err)
	if len(input.Posts) != 1 || input.Posts[0].ID != "93101" || !input.Targets.Likes[93101] || !input.Targets.Comments[93101] {
		t.Fatalf("relevant real owner post missing, or unsafe/unrelated candidate included: %+v", input.Posts)
	}
	for _, author := range []int64{93001, 93005, 93007, 93008} {
		allowed, err := managedPublicTarget(db, job, author)
		check(err)
		if allowed {
			t.Fatalf("invalid public target accepted: %d", author)
		}
	}
	allowed, err := managedPublicTarget(db, job, 93002)
	check(err)
	if !allowed {
		t.Fatal("existing managed peers lost access")
	}
	newRun := func() {
		job.RunID++
		check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,'2026-10-16','2026-10','running',10,10,?)`, job.RunID, job.AgentID, job.SponsorUID, now).Error)
	}
	eligible := map[int64]bool{93101: true}
	like := managedModelResult{UsageKnown: true, Input: 20, Output: 20, Targets: input.Targets, Value: managedOutput{Action: "like", PostID: "93101"}}
	comment := managedModelResult{UsageKnown: true, Input: 20, Output: 20, Targets: input.Targets, Value: managedOutput{Action: "comment", PostID: "93101", Content: "你这盆番茄种了多久才开花？我也在找适合阳台种的品种。"}}
	// Recheck visibility and blocks at commit, not just at discovery time.
	newRun()
	check(db.Exec(`UPDATE social_work_posts SET visibility='private' WHERE post_id=93101`).Error)
	if s.commitManaged(ctx, job, like, eligible) == nil || s.commitManaged(ctx, job, comment, eligible) == nil {
		t.Fatal("stale public candidate bypassed private visibility")
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='public' WHERE post_id=93101`).Error)
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(93003,93001,2,1)`).Error)
	if s.commitManaged(ctx, job, like, eligible) == nil || s.commitManaged(ctx, job, comment, eligible) == nil {
		t.Fatal("stale candidate bypassed block")
	}
	check(db.Exec(`DELETE FROM user_relations WHERE from_uid=93003 AND to_uid=93001`).Error)
	if s.commitManaged(ctx, job, like, nil) == nil {
		t.Fatal("unsupplied target accepted")
	}
	check(s.commitManaged(ctx, job, like, eligible))
	newRun()
	check(s.commitManaged(ctx, job, comment, eligible))
	var count int64
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE post_id=93101`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("real owner comment not committed", count)
	}
	// A second role with a stale candidate cannot pile on after the first role.
	job.AgentID = 93002
	newRun()
	check(s.commitManaged(ctx, job, like, eligible))
	newRun()
	check(s.commitManaged(ctx, job, comment, eligible))
	check(db.Raw(`SELECT count(*) FROM social_work_reactions WHERE post_id=93101 AND kind='like'`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("cohort piled on likes", count)
	}
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE post_id=93101`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("cohort piled on comments", count)
	}
	posts, err := managedOwnerPosts(db, job)
	check(err)
	for _, p := range posts {
		if p.ID == "93101" {
			t.Fatal("exhausted candidate still offered", posts)
		}
	}
	check(db.Exec(`UPDATE social_work_comments SET created_at=? WHERE post_id=93101`, time.Now().Add(-25*time.Hour).UnixMilli()).Error)
	posts, err = managedOwnerPosts(db, job)
	check(err)
	var reopened bool
	for _, p := range posts {
		if p.ID == "93101" {
			reopened = !p.CanLike && p.CanComment
		}
	}
	if !reopened {
		t.Fatal("comment cooldown failed to reopen independently", posts)
	}
}
