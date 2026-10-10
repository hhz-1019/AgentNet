package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestManagedMaintenanceRelationsLikesAndDaily(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("full schema required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	s := &Service{db: db, idgen: &managedTestIDs{id: 980000}}
	for _, id := range []int64{97001, 97002, 97003} {
		check(insertProvisionedAgent(db, id, fmt.Sprintf("maintenance%d@identity.invalid", id), "测试角色", 1))
	}
	h := server.New()
	check(db.Exec("INSERT INTO friend_requests(id,from_uid,to_uid,status,greeting,created_at,updated_at) VALUES(97099,97001,97002,0,'测试申请',1,1)").Error)
	h.PUT("/people/:person_id/follow", func(ctx context.Context, c *app.RequestContext) {
		id := int64(97001)
		if c.Query("reverse") == "1" {
			id = 97002
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}, s.putFollow)
	follow := func(reverse, enabled bool, want int) followState {
		t.Helper()
		path := "/people/97002/follow"
		if reverse {
			path = "/people/97001/follow?reverse=1"
		}
		body := fmt.Sprintf(`{"following":%t}`, enabled)
		r := ut.PerformRequest(h.Engine, "PUT", path, &ut.Body{Body: strings.NewReader(body), Len: len(body)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("follow: %d %s", r.Code, r.Body.String())
		}
		var result struct {
			Data followState `json:"data"`
		}
		check(json.Unmarshal(r.Body.Bytes(), &result))
		return result.Data
	}
	if follow(false, true, 200).Friends {
		t.Fatal("one-way follow granted friendship")
	}
	if r := follow(true, true, 200); !r.Friends || !r.FollowedBy {
		t.Fatal("mutual follow missing friendship", r)
	}
	follow(true, true, 200)
	var count int64
	check(db.Raw("SELECT status FROM friend_requests WHERE id=97099").Scan(&count).Error)
	if count != 1 {
		t.Fatal("mutual follow left a pending friend request")
	}
	check(db.Raw("SELECT count(*) FROM user_relations WHERE from_uid IN (97001,97002) AND rel_type=1").Scan(&count).Error)
	if count != 2 {
		t.Fatal("duplicate/asymmetric friends", count)
	}
	if follow(false, false, 200).Friends {
		t.Fatal("unfollow retained generated friendship")
	}
	if r := follow(true, true, 200); r.Friends || !r.Following {
		t.Fatal("unfollow removed other person's follow", r)
	}
	follow(false, true, 200)
	check(db.Exec("INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(97001,97002,2,1)").Error)
	follow(true, true, 404)
	check(db.Raw("SELECT count(*) FROM social_follows WHERE follower_id IN (97001,97002)").Scan(&count).Error)
	if count != 0 {
		t.Fatal("block retained follows")
	}
	check(db.Exec("DELETE FROM user_relations WHERE from_uid IN (97001,97002)").Error)
	check(db.Exec("INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(97001,97002,1,1),(97002,97001,1,1)").Error)
	follow(false, true, 200)
	follow(true, true, 200)
	if !follow(false, false, 200).Friends {
		t.Fatal("unfollow deleted pre-existing friend")
	}

	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('maintenance',987654301,'!x','!x',1),('maintenance-a',987654302,'!x','!x',1),('maintenance-b',987654303,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('maintenance',true,10000,1,1);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled) VALUES(97001,'maintenance-a','maintenance',0,'甲','学习互助','测试',true),(97002,'maintenance-b','maintenance',1,'乙','学习互助','测试',true);
 INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(97010,97002,'published',1,'public','{}',1,1,1);`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654301")
	job := managedJob{AgentID: 97001, SponsorUID: "maintenance", Scenario: "学习互助", Revision: 1, RunID: 97020, Reserved: 1, InputRate: 1, OutputRate: 1}
	newRun := func() {
		check(db.Exec("INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,97001,'maintenance','2026-10-09','2026-10','running',1,1,1)", job.RunID).Error)
	}
	newRun()
	like := managedModelResult{Value: managedOutput{Action: "like", PostID: "97010"}, Input: 10, Output: 10}
	check(db.Exec("UPDATE social_work_posts SET visibility='private' WHERE post_id=97010").Error)
	if s.commitManaged(context.Background(), job, like, map[int64]bool{97010: true}) == nil {
		t.Fatal("private like accepted")
	}
	check(db.Exec("UPDATE social_work_posts SET visibility='public' WHERE post_id=97010").Error)
	if s.commitManaged(context.Background(), job, like, nil) == nil {
		t.Fatal("unknown candidate accepted")
	}
	check(s.commitManaged(context.Background(), job, like, map[int64]bool{97010: true}))
	job.RunID++
	newRun()
	check(s.commitManaged(context.Background(), job, like, map[int64]bool{97010: true}))
	check(db.Exec("INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) SELECT 97100+i,97001,'maintenance','2026-10-09','2026-10','skipped',0,0,1 FROM generate_series(1,60) i").Error)
	check(db.Raw("SELECT count(*) FROM social_work_reactions WHERE post_id=97010 AND kind='like'").Scan(&count).Error)
	if count != 1 {
		t.Fatal("duplicate like")
	}
	raw, err := s.managedDailySummary(context.Background(), "maintenance", "2026-10-09")
	check(err)
	var summary map[string]any
	check(json.Unmarshal(raw, &summary))
	if summary["liked"] != float64(1) || summary["skipped"] != float64(61) || summary["attempts"] != float64(62) {
		t.Fatal(string(raw))
	}
	midnight := time.Date(2026, 10, 9, 16, 5, 0, 0, time.UTC)
	check(s.persistManagedDaily(context.Background(), midnight))
	check(db.Raw("SELECT count(*) FROM managed_daily_reports WHERE sponsor_uid='maintenance'").Scan(&count).Error)
	if count != 0 {
		t.Fatal("report finalized before settlement window")
	}
	check(s.persistManagedDaily(context.Background(), midnight.Add(6*time.Minute)))
	check(s.persistManagedDaily(context.Background(), midnight.Add(7*time.Minute)))
	check(db.Raw("SELECT count(*) FROM managed_daily_reports WHERE sponsor_uid='maintenance' AND day='2026-10-09'").Scan(&count).Error)
	if count != 1 {
		t.Fatal("report missing or duplicated")
	}
	raw, err = s.managedDailySummary(context.Background(), "maintenance", "2026-10-10")
	check(err)
	check(json.Unmarshal(raw, &summary))
	if summary["attempts"] != float64(0) {
		t.Fatal("day boundary leaked")
	}
	raw, err = s.managedDailySummary(context.Background(), "other", "2026-10-09")
	check(err)
	check(json.Unmarshal(raw, &summary))
	if summary["attempts"] != float64(0) {
		t.Fatal("sponsor ledger leaked")
	}
}
