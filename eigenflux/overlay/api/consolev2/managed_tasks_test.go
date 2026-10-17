package consolev2

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestManagedAtomicTasksAndPrivatePriority(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	ctx := context.Background()
	// Production-sized receiver IDs expose SQL inference of NULLIF parameters.
	for _, id := range []int64{99501, 99502, 99503, 369454428261974016} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@task.invalid", "任务验收", now.UnixMilli()))
		activityFixtureGrants(t, db, id)
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('task-sponsor',987654210,'!x','!x',1),('task-a',987654211,'!x','!x',1),('task-b',987654212,'!x','!x',1),('task-c',987654213,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million,dm_reply_enabled,dm_start_enabled) VALUES('task-sponsor',true,10000,1,1,true,false);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled,daily_limit,start_hour,end_hour,next_run_at) VALUES(99501,'task-a','task-sponsor',0,'甲','学习互助','测试',true,2,23,24,0),(99502,'task-b','task-sponsor',1,'乙','学习互助','测试',true,2,0,24,0),(99503,'task-c','task-sponsor',2,'丙','学习互助','测试',true,2,0,24,?);
 INSERT INTO agent_settings(agent_id,auto_reply_pm,auto_start_pm,updated_at) VALUES(99503,true,false,1) ON CONFLICT(agent_id) DO UPDATE SET auto_reply_pm=true,auto_start_pm=false;`, now.Add(time.Hour).UnixMilli()).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654210")
	s := &Service{db: db, idgen: &managedTestIDs{id: 99500000}}
	night := time.Date(now.Year(), now.Month(), now.Day()+1, 19, 0, 0, 0, time.UTC) // 03:00 Shanghai next day.
	blockedAtNight, err := managedQueueBlock(db, "task-sponsor", 99501, night)
	check(err)
	if blockedAtNight != "" {
		t.Fatal("legacy hours blocked nighttime queue", blockedAtNight)
	}
	check(db.Exec("UPDATE managed_members SET enabled=false WHERE agent_id=99501").Error)
	paused, err := managedQueueBlock(db, "task-sponsor", 99501, night)
	check(err)
	if paused == "" {
		t.Fatal("all-day activity bypassed pause")
	}
	check(db.Exec("UPDATE managed_members SET enabled=true WHERE agent_id=99501").Error)
	req := managedQueueRequest{Action: "post", Topic: "同一个讨论主题", RequestKey: "task-a", Schedule: &managedQueueSchedule{Revision: 1, DailyLimit: 0, StartHour: 0, EndHour: 24}}
	_, blocked, err := s.queueManagedTask("task-sponsor", 99501, req)
	check(err)
	if blocked == "" {
		t.Fatal("daily cap bypassed")
	}
	var start int
	check(db.Raw(`SELECT start_hour FROM managed_members WHERE agent_id=99501`).Scan(&start).Error)
	if start != 23 {
		t.Fatal("rejected queue changed hours")
	}
	req.Schedule.DailyLimit = 2
	result, blocked, err := s.queueManagedTask("task-sponsor", 99501, req)
	check(err)
	if blocked != "" || result["task_id"] != "task-a" {
		t.Fatal("atomic queue failed", blocked)
	}
	_, blocked, err = s.queueManagedTask("task-sponsor", 99501, req)
	check(err)
	if blocked != "" {
		t.Fatal("identical request not idempotent")
	}
	changed := req
	changed.Topic += "！"
	if _, _, err = s.queueManagedTask("task-sponsor", 99501, changed); err == nil {
		t.Fatal("same key different payload accepted")
	}
	changed.RequestKey = "task-overwrite"
	_, blocked, err = s.queueManagedTask("task-sponsor", 99501, changed)
	check(err)
	if blocked == "" {
		t.Fatal("pending task overwritten")
	}
	second := managedQueueRequest{Action: "post", Topic: req.Topic, RequestKey: "task-b"}
	_, blocked, err = s.queueManagedTask("task-sponsor", 99502, second)
	check(err)
	if blocked != "" {
		t.Fatal("same-theme comparison blocked", blocked)
	}
	check(db.Exec("UPDATE managed_members SET start_hour=8,end_hour=24 WHERE agent_id=99501").Error)
	job, err := s.claimManaged(ctx, night)
	check(err)
	if job == nil || job.AgentID != 99501 || job.Action != "post" || job.TaskID != "task-a" {
		t.Fatal("task action lost", job)
	}
	_, blocked, err = s.queueManagedTask("task-sponsor", 99501, req)
	check(err)
	if blocked != "" {
		t.Fatal("retry after claim created another task", blocked)
	}
	// A reply wakes a role whose next public slot is an hour away and takes the
	// private lane without consuming/replacing role B's queued public task.
	check(db.Exec(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,origin_type,origin_id,updated_at,topic_status) VALUES(995500,99503,369454428261974016,369454428261974016,369454428261974016,'direct',0,?,1);
 INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(995501,995500,369454428261974016,99503,'我只读了半本书，第一次在读书会上怎样开口？',?);`, now.UnixMilli(), now.UnixMilli()).Error)
	replyJob, err := s.claimManagedMode(ctx, now.Add(2*time.Second), true)
	check(err)
	if replyJob == nil || replyJob.AgentID != 99503 || replyJob.Action != "message" {
		t.Fatal("private reply waited behind bulk posts", replyJob)
	}
	check(db.Exec(`UPDATE managed_runs SET status='skipped',charged_fen=0 WHERE run_id=?`, replyJob.RunID).Error)
	var pending string
	check(db.Raw(`SELECT pending_task_id FROM managed_members WHERE agent_id=99502`).Scan(&pending).Error)
	if pending != "task-b" {
		t.Fatal("reply stole public task")
	}
	explicit := managedQueueRequest{Action: "message", RecipientID: "369454428261974016", RequestKey: "reply-existing"}
	_, blocked, err = s.queueManagedTask("task-sponsor", 99503, explicit)
	check(err)
	if blocked != "" {
		t.Fatal("existing reply wrongly required proactive permission", blocked)
	}
	input, err := s.managedContext(ctx, managedJob{AgentID: 99503, SponsorUID: "task-sponsor", Action: "post"})
	check(err)
	if input.Message != nil || len(input.Messages) > 0 {
		t.Fatal("post task received private context")
	}
	r, err := s.claimManagedMode(ctx, now.Add(3*time.Second), true)
	check(err)
	if r == nil || r.TaskID != "reply-existing" {
		t.Fatal("explicit reply task missing")
	}
	// Enforcement is server-side, independent of whatever an LLM was told.
	bad := managedModelResult{Value: managedOutput{Action: "comment", PostID: "1", Content: "这条评论不能替代指定的发帖任务。"}}
	if err := s.commitManaged(ctx, *job, bad, map[int64]bool{1: true}); managedFailureCode(err) != "task_action" {
		t.Fatal("wrong action not rejected", err)
	}
}
