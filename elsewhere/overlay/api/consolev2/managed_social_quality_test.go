package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestManagedTextQuality(t *testing.T) {
	roles := managedCatalog()
	plantAngle := managedAngle(managedJob{Persona: roles[96].Persona})
	gameAngle := managedAngle(managedJob{Persona: roles[94].Persona})
	if !strings.Contains(plantAngle, "植物") || !strings.Contains(gameAngle, "桌游") || plantAngle == gameAngle {
		t.Fatal("role focus was lost")
	}
	seed := 96
	edited := managedAngle(managedJob{SeedIndex: &seed, PersonaEdited: true, Persona: "运营自定义身份，关注城市声音记录。"})
	if strings.Contains(edited, managedCaseHooks[96]) {
		t.Fatal("edited persona was steered back to original seed")
	}
	if !managedSimilarTitle("过程页放几版草稿，我其实先看它删了什么", "作品集里那页过程，我常先看它删了什么") {
		t.Fatal("observed title template escaped")
	}
	if managedSimilarTitle("植物记录需要同时保留光照与温度", "读书交流先选一个能讨论的具体问题") {
		t.Fatal("unrelated title blocked")
	}
	post := "看到 Mangata 的介绍里有一句：不一定要拍满，也不一定要发，走完看看留下了什么就够了。这句我挺喜欢。散步记录常被默认成一次产出，要拍够、要发出去才算数。可走岔的那次、什么都没拍的那次，回头看反而是我唯一记得住的。先不急着给它加提醒和分享按钮吧。"
	copied := "这句我也喜欢。库存提醒常被默认成一次记录，要填够、要算准才算数，可小店进货本来就不规律，填出来的日均反而像承诺。先不急着给它加提醒和分享按钮吧。"
	if !managedCopiesPost(copied, post) {
		t.Fatal("observed comment template escaped")
	}
	if managedCopiesPost("我赞同这个判断", post) || managedCopiesPost("散步中停下来等待的时间也值得保留。可以把停留位置单独做个标记，回看时不必靠照片数量猜测。", post) {
		t.Fatal("independent comment blocked")
	}
	if managedSourceKey("https://sspai.com/post/123/?utm_source=test#anchor") != managedSourceKey("https://sspai.com/post/123") {
		t.Fatal("canonical source variants bypass quota")
	}
	if !managedNearText("作品集先展示取舍：删掉了什么？", "作品集先展示取舍 删掉了什么") {
		t.Fatal("punctuation bypass")
	}
	if !managedNearText("ＡＢＣ１２３", "abc123") {
		t.Fatal("unicode normalization bypass")
	}
	if managedNearText("我赞同这个判断", "我不赞同这个判断") {
		t.Fatal("short replies overblocked")
	}
	if managedNearText("记录作品集里被放弃的选择有助于理解设计约束，尤其是只剩一页展示空间的时候。", "桌游讲规则时先让新人玩一轮，卡住的那一步再解释比一开始念完说明书更容易理解。") {
		t.Fatal("unrelated posts rejected")
	}
	if managedWritingIssue(managedOutput{Action: "message", Content: strings.Repeat("字", 301)}) == "" {
		t.Fatal("message limit missing")
	}
	c := managedContext{Recent: make([]managedPostHistory, 30)}
	for i := range c.Recent {
		c.Recent[i].Body = strings.Repeat("字", 1000)
	}
	payload := map[string]any{"persona": strings.Repeat("人", 1600)}
	if !managedFitInput(payload, &c) || len(c.Recent) >= 30 {
		t.Fatal("context not bounded")
	}
	raw, _ := json.Marshal(payload)
	if len(raw)+len(managedPrompt) > managedMaxInput-1000 {
		t.Fatal("byte ceiling exceeded")
	}
}

func TestManagedSocialInteractions(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	t.Cleanup(func() { db.Rollback() })
	ctx := context.Background()
	s := &Service{db: db, idgen: &managedTestIDs{id: 98000000}}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	for _, id := range []int64{98001, 98002, 98003} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@quality.invalid", "质量验收"+fmtRun(id), now))
		activityFixtureGrants(t, db, id)
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('quality',987654311,'!x','!x',1),('quality-a',987654312,'!x','!x',1),('quality-b',987654313,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million,dm_reply_enabled,dm_start_enabled) VALUES('quality',true,10000,1,1,true,true);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled) VALUES(98001,'quality-a','quality',0,'甲','学习互助','测试',true),(98002,'quality-b','quality',1,'乙','科研交流','测试',true);
 INSERT INTO agent_settings(agent_id,auto_reply_pm,auto_start_pm,updated_at) VALUES(98001,true,true,1),(98002,true,true,1) ON CONFLICT(agent_id) DO UPDATE SET auto_reply_pm=true,auto_start_pm=true;
 INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(98001,98002,1,1),(98002,98001,1,1);`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654311")
	job := managedJob{AgentID: 98001, SponsorUID: "quality", Scenario: "学习互助", Revision: 1, RunID: 981000}
	newRun := func() {
		job.RunID++
		check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,'2026-10-15','2026-10','running',10,10,?)`, job.RunID, job.AgentID, job.SponsorUID, time.Now().UnixMilli()).Error)
	}
	doc := `{"title":"具体标题","summary":"这是一个具体问题的必要补充","body":"整理错题时我更想保留当时的误判，而不是照抄完整题目。写清误判，下一次才能检查自己有没有改过来。","kind":"question","tags":["学习"]}`
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(98010,98001,'published',1,'public',?::jsonb,?,?,1),(98011,98002,'published',1,'public',?::jsonb,?,?,1),(98012,98002,'draft',1,'private',?::jsonb,?,?,1)`, doc, now, now, doc, now, now, doc, now, now).Error)
	check(db.Exec(`UPDATE social_work_posts SET document=jsonb_set(document,'{body}','"quality-private-secret"') WHERE post_id=98012`).Error)
	check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES(98020,98010,98002,'这个误判记录能否再保留一个反例？','quality-incoming',?)`, now).Error)
	input, err := s.managedContext(ctx, job)
	check(err)
	if input.Message == nil || input.Message.TriggerCommentID != 98020 {
		t.Fatal("friend private candidate missing", input)
	}
	result := managedModelResult{UsageKnown: true, Input: 20, Output: 20, Targets: input.Targets, Value: managedOutput{Action: "message", RecipientID: input.Message.RecipientID, ConversationID: input.Message.ConversationID, ReplyToMessageID: input.Message.ReplyToMessageID, Content: "你刚才说的反例值得单独留一行，能否用一个具体误判继续讨论？"}}
	// Invalid white-list targets never create messages.
	newRun()
	bad := result
	bad.Value.RecipientID = "98003"
	if s.commitManaged(ctx, job, bad, nil) == nil {
		t.Fatal("unsupplied recipient accepted")
	}
	check(s.commitManaged(ctx, job, result, nil))
	var count int64
	check(db.Raw(`SELECT count(*) FROM private_messages WHERE sender_id=98001 AND receiver_id=98002 AND actor_kind='agent' AND NOT is_read`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("message missing", count)
	}
	var receipt struct {
		Status                                        string
		PostID, MessageID, ConversationID, ChargedFen int64
	}
	check(db.Raw(`SELECT status,post_id,message_id,conversation_id,charged_fen FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&receipt).Error)
	if receipt.Status != "messaged" || receipt.PostID != 0 || receipt.MessageID == 0 || receipt.ConversationID == 0 || receipt.ChargedFen != 0 {
		t.Fatal("ledger mismatch", receipt)
	}
	check(db.Raw(`SELECT count(*) FROM analytics_agent_events WHERE source='message' AND event_key=?`, fmtRun(receipt.MessageID)).Scan(&count).Error)
	if count != 1 {
		t.Fatal("analytics mirror missing")
	}
	check(s.notifyManagedMessages(ctx)) // No Redis: keep outbox pending for a later worker.
	check(db.Raw(`SELECT count(*) FROM managed_message_receipts WHERE run_id=? AND notified_at IS NULL`, job.RunID).Scan(&count).Error)
	if count != 1 {
		t.Fatal("outbox lost")
	}
	cache := miniredis.RunT(t)
	s.redisClient = redis.NewClient(&redis.Options{Addr: cache.Addr()})
	t.Cleanup(func() { s.redisClient.Close() })
	check(s.redisClient.Set(ctx, "pm:fetch:98002", "stale", 0).Err())
	check(s.notifyManagedMessages(ctx))
	if cache.Exists("pm:fetch:98002") {
		t.Fatal("unread cache not invalidated")
	}
	activityCount, err := s.redisClient.XLen(ctx, "stream:agent:activity").Result()
	check(err)
	if activityCount != 2 {
		t.Fatal("message activity missing", activityCount)
	}
	// Delivery completed but recording its DB receipt failed: Redis retry is idempotent.
	check(db.Exec(`UPDATE managed_message_receipts SET notified_at=NULL WHERE run_id=?`, job.RunID).Error)
	check(s.notifyManagedMessages(ctx))
	activityCount, err = s.redisClient.XLen(ctx, "stream:agent:activity").Result()
	check(err)
	if activityCount != 2 {
		t.Fatal("notification retry duplicated activity")
	}
	newRun()
	check(s.commitManaged(ctx, job, result, nil))
	check(db.Raw(`SELECT count(*) FROM private_messages WHERE sender_id=98001`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("repeat send")
	}
	// Private context cannot be repurposed for a public post.
	newRun()
	bad = result
	bad.Value = managedOutput{Action: "post"}
	check(s.commitManaged(ctx, job, bad, nil))
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&receipt.Status).Error)
	if receipt.Status != "skipped" {
		t.Fatal("private context escaped")
	}
	check(db.Exec(`UPDATE managed_message_receipts SET created_at=? WHERE sender_id=98001`, time.Now().Add(-31*time.Minute).UnixMilli()).Error)
	incoming, err := s.idgen.NextID()
	check(err)
	check(db.Exec(`INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at,actor_kind) VALUES(?,?,98002,98001,'可以先把题目条件写在旁边，再找一个不满足条件的反例。',?,'agent')`, incoming, receipt.ConversationID, now).Error)
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message == nil || input.Message.ReplyToMessageID != fmtRun(incoming) {
		t.Fatal("reply candidate missing")
	}
	result.Targets = input.Targets
	result.Value.ConversationID = input.Message.ConversationID
	result.Value.ReplyToMessageID = input.Message.ReplyToMessageID
	result.Value.Content = "条件和反例分开记更清楚，我会把讨论集中在缺少条件时哪一步失效。"
	check(db.Exec(`UPDATE managed_campaigns SET dm_reply_enabled=false WHERE sponsor_uid='quality'`).Error)
	newRun()
	check(s.commitManaged(ctx, job, result, nil))
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&receipt.Status).Error)
	if receipt.Status != "skipped" {
		t.Fatal("disabled DM committed")
	}
	check(db.Exec(`UPDATE managed_campaigns SET dm_reply_enabled=true WHERE sponsor_uid='quality'`).Error)
	newRun()
	check(s.commitManaged(ctx, job, result, nil))
	check(db.Raw(`SELECT count(*) FROM private_messages WHERE msg_id=? AND NOT is_read`, incoming).Scan(&count).Error)
	if count != 1 {
		t.Fatal("automation changed owner read receipt")
	}
	// Public round: private messages are absent; drafts are absent; cross-scene likes survive.
	check(db.Exec(`UPDATE managed_campaigns SET dm_reply_enabled=false,dm_start_enabled=false WHERE sponsor_uid='quality'`).Error)
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message != nil || len(input.Messages) > 0 {
		t.Fatal("private context in public round")
	}
	for _, h := range input.Recent {
		if strings.Contains(h.Body, "quality-private-secret") {
			t.Fatal("private draft leaked")
		}
	}
	reply, ok := input.Targets.Replies[98020]
	if !ok {
		t.Fatal("public reply missing")
	}
	result.Targets = input.Targets
	result.Value = managedOutput{Action: "comment", PostID: reply.PostID, ReplyToCommentID: reply.ID, Content: "如果错在忽略条件，我更想记录一个条件失效时答案改变的反例。"}
	newRun()
	check(s.commitManaged(ctx, job, result, nil))
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE reply_to_comment_id=98020 AND agent_id=98001`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("reply association missing")
	}
	newRun()
	check(s.commitManaged(ctx, job, result, nil))
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE reply_to_comment_id=98020 AND agent_id=98001`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("duplicate reply")
	}
	// Title changes must not bypass cross-role body deduplication.
	var duplicateDoc socialDocument
	check(json.Unmarshal([]byte(doc), &duplicateDoc))
	duplicateDoc.Title = "另一个不同的标题"
	newRun()
	check(s.commitManaged(ctx, job, managedModelResult{Value: managedOutput{Action: "post", Document: duplicateDoc}, UsageKnown: true, Input: 20, Output: 20}, nil))
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&receipt.Status).Error)
	if receipt.Status != "skipped" {
		t.Fatal("body duplicate escaped")
	}
	// A like and a normal comment may both exist on the same public peer post.
	newRun()
	check(s.commitManaged(ctx, job, managedModelResult{Value: managedOutput{Action: "like", PostID: "98011"}}, map[int64]bool{98011: true}))
	newRun()
	check(s.commitManaged(ctx, job, managedModelResult{Value: managedOutput{Action: "comment", PostID: "98011", Content: "我更在意回看时能不能明确说出哪条条件改变了，而不是只记住题目的答案。"}}, map[int64]bool{98011: true}))
	check(db.Raw(`SELECT count(*) FROM social_work_reactions WHERE post_id=98011 AND agent_id=98001`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("cross-scene like missing")
	}
	// A comment cannot transplant the target post's sentences as its own reply.
	copyDoc := duplicateDoc
	copyDoc.Body = "记录植物时先写清楚天气和光照条件，再把看到的变化与自己的推测分开，下一次观察才有比较的依据。"
	copyJSON, _ := json.Marshal(copyDoc)
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(98015,98002,'published',1,'public',?::jsonb,?,?,1)`, string(copyJSON), now, now).Error)
	newRun()
	check(s.commitManaged(ctx, job, managedModelResult{Value: managedOutput{Action: "comment", PostID: "98015", Content: copyDoc.Body}, UsageKnown: true}, map[int64]bool{98015: true}))
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&receipt.Status).Error)
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE post_id=98015`).Scan(&count).Error)
	if receipt.Status != "skipped" || count != 0 {
		t.Fatal("copied comment was published")
	}
	// Field failures remain actionable while keeping model text out of receipts.
	newRun()
	badDocument := duplicateDoc
	badDocument.Summary = "太短"
	invalidResult := managedModelResult{Value: managedOutput{Action: "post", Document: badDocument}, Requested: true, UsageKnown: true, Input: 20, Output: 20}
	invalidErr := s.commitManaged(ctx, job, invalidResult, nil)
	if invalidErr == nil || managedFailureCode(invalidErr) != "content_summary" {
		t.Fatal("schema failure lost field category", invalidErr)
	}
	s.finishManagedFailure(job, invalidResult, invalidErr)
	var failure struct {
		Detail     string
		ChargedFen int64
	}
	check(db.Raw(`SELECT detail,charged_fen FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&failure).Error)
	if !strings.Contains(failure.Detail, "[content_summary]") || failure.ChargedFen != 0 {
		t.Fatal("field receipt or known usage lost", failure)
	}
	raw, err := s.managedDailySummary(ctx, "quality", "2026-10-15")
	check(err)
	var summary map[string]any
	check(json.Unmarshal(raw, &summary))
	if summary["messaged"] != float64(2) {
		t.Fatal("DM daily summary missing", string(raw))
	}
	// A single public source has two live slots, shared across roles and replicas.
	cacheItems, _ := json.Marshal([]managedSource{{ID: "1", Title: "独立测试材料", URL: "https://sspai.com/post/managed-quality-fixture", Published: time.Now().UTC().Format(time.RFC3339), Summary: "仅用于隔离缓存测试"}})
	for _, feed := range managedFeedURLs {
		check(db.Exec(`INSERT INTO managed_source_cache(feed_url,fetched_at,items,status) VALUES(?,?,?::jsonb,'ready') ON CONFLICT(feed_url) DO UPDATE SET fetched_at=EXCLUDED.fetched_at,items=EXCLUDED.items`, feed, time.Now().UnixMilli(), string(cacheItems)).Error)
	}
	var firstSourceRun int64
	for i := 0; i < 3; i++ {
		newRun()
		if i == 0 {
			firstSourceRun = job.RunID
		}
		sources, err := s.managedRoleSources(ctx, job)
		check(err)
		want := 1
		if i == 2 {
			want = 0
		}
		if len(sources) != want {
			t.Fatal("source reservation fanout", i, len(sources))
		}
	}
	check(db.Exec(`UPDATE managed_runs SET status='skipped' WHERE run_id=?`, firstSourceRun).Error)
	newRun()
	sources, err := s.managedRoleSources(ctx, job)
	check(err)
	if len(sources) != 1 {
		t.Fatal("skipped source reservation was not released")
	}
	// Old public posts have no source_key but must still occupy their quota.
	check(db.Exec(`UPDATE managed_runs SET status='skipped' WHERE sponsor_uid='quality' AND status='running'`).Error)
	legacyDoc := duplicateDoc
	legacyJSON, _ := json.Marshal(legacyDoc)
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(98013,98001,'published',1,'public',?::jsonb,?,?,1),(98014,98002,'published',1,'public',?::jsonb,?,?,1)`, string(legacyJSON), now, now, string(legacyJSON), now, now).Error)
	legacySnapshot, _ := json.Marshal([]managedSource{{URL: "https://sspai.com/post/managed-quality-fixture?utm_source=old#top"}})
	for _, post := range []int64{98013, 98014} {
		check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at,post_id,source_snapshot) VALUES(?,98001,'quality','2026-10-15','2026-10','published',0,0,?,?,?::jsonb)`, post, now, post, string(legacySnapshot)).Error)
	}
	newRun()
	sources, err = s.managedRoleSources(ctx, job)
	check(err)
	if len(sources) != 0 {
		t.Fatal("legacy public source usage was ignored")
	}
}
