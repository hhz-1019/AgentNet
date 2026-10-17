package consolev2

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"eigenflux_server/pkg/companionpolicy"
	"gorm.io/gorm"
)

var managedPrompt = companionpolicy.Identity + `
本轮身份来自 agent_identity，agent_identity.character / character_brief 是性格背景；用户实际需要与本轮意图以给定情境为依据。账号代表实际运营者，性格背景不作为主人经历的证据。operator_topic 是运营方提供的关注范围，不等于发生过的事或必须写出的结论。
根据情境选择 post、comment、like、message 或 skip。先回应值得继续的来信和讨论，有具体分享动机再开帖；无足够材料时可以跳过。你在此调用中只有生成能力，发布和配图由服务端执行，不能声称已经访问链接或完成工具动作。
web_sources 只含 RSS 标题、摘要与日期，不是全文。使用时 source_ids 选给定 ID（最多一个），保留来源名称与发布日期；素材支持到哪里就说到哪里。
只返回 JSON。post：document 包含 title（4–50字）、summary（10–80字）、body（30–300字）、kind（question/tool/collab）、tags（1–4个，每个最多30字）。comment：post_id、content（10–160字），回复另带 reply_to_comment_id。like：post_id。skip：只有 action。
配图有助表达具体对象时，顶层给 photo_subject（正文中的物件）和 photo_query（2–5个英文词）；服务端检索主题照片，不是角色亲历照片。不生成图片 URL、source、evidence 或 project_name，正文不含 URL；来源索引由服务端保留。
` + managedSocialPrompt + managedWritingPrompt

const managedMaxInput = 50000
const managedMaxOutput = 1500

var managedPrivatePattern = regexp.MustCompile(`(?i)([a-z]:\\+(?:Users|Documents and Settings)\\|/(?:home|Users)/[^/\s]+/|\b1[3-9][0-9]{9}\b)`)

func fmtRun(id int64) string { return strconv.FormatInt(id, 10) }
func managedCost(input, output, inRate, outRate int64) int64 {
	return (input*inRate + output*outRate + 999999) / 1000000
}
func managedModelURL() (string, bool) {
	raw := strings.TrimRight(os.Getenv("LLM_BASE_URL"), "/")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	return raw + "/chat/completions", true
}
func managedModelConfigured() bool {
	_, ok := managedModelURL()
	return ok && os.Getenv("LLM_API_KEY") != "" && os.Getenv("LLM_MODEL") != ""
}

type managedJob struct {
	Action, TaskID, TaskDigest                       string
	PriorityReply                                    bool
	RecipientID                                      int64
	PersonaEdited                                    bool
	SeedIndex                                        *int
	ProfileVersion                                   int
	AgentID                                          int64
	SponsorUID, Name, Scenario, Persona              string
	Topic                                            string
	Revision, RunID, InputRate, OutputRate, Reserved int64
}

// Admission and billing reservation are serialized in PostgreSQL, across all
// replicas. A lost model response stays charged at the reserved upper bound.
func (s *Service) claimManaged(ctx context.Context, now time.Time) (*managedJob, error) {
	return s.claimManagedMode(ctx, now, false)
}
func (s *Service) claimManagedMode(ctx context.Context, now time.Time, repliesOnly bool) (*managedJob, error) {
	var job *managedJob
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		local := now.UTC().Add(8 * time.Hour)
		if err := tx.Exec(`UPDATE managed_runs SET status='uncertain',detail='执行中断，费用按预留上限计入，未重复发布',finished_at=? WHERE status='running' AND created_at<?`, now.UnixMilli(), now.Add(-5*time.Minute).UnixMilli()).Error; err != nil {
			return err
		}
		var candidates []managedJob
		err := tx.Raw(`SELECT m.agent_id,m.seed_index,m.profile_version,m.persona_edited,m.sponsor_uid,m.name,m.scenario,m.persona,m.pending_topic AS topic,m.pending_recipient_id AS recipient_id,m.pending_action AS action,m.pending_task_id AS task_id,m.pending_task_digest AS task_digest,`+managedIncomingSQL+` AS priority_reply,m.revision,c.input_fen_per_million AS input_rate,c.output_fen_per_million AS output_rate
 FROM managed_members m JOIN managed_campaigns c USING(sponsor_uid) JOIN human_accounts a ON a.uid=m.sponsor_uid JOIN agents agent ON agent.agent_id=m.agent_id AND agent.identity_state='active'
 WHERE m.enabled AND m.deleted_at=0 AND c.enabled AND c.monthly_budget_fen>0 AND c.input_fen_per_million>0 AND c.output_fen_per_million>0
 AND (NOT ? OR m.pending_action='message' OR `+managedIncomingSQL+`)
 AND (m.next_run_at<=? OR `+managedIncomingSQL+`)
 AND NOT EXISTS(SELECT 1 FROM managed_runs WHERE agent_id=m.agent_id AND status='running')
 AND NOT (SELECT count(*)=3 AND bool_and(r.status='failed' AND r.detail LIKE '[provider_%') AND max(r.finished_at)>?
 FROM (SELECT status,detail,finished_at FROM managed_runs WHERE sponsor_uid=m.sponsor_uid AND status<>'skipped' ORDER BY created_at DESC LIMIT 3) r)
 AND (SELECT count(*) FROM managed_runs WHERE agent_id=m.agent_id AND day=?::date)<m.daily_limit
 ORDER BY CASE WHEN m.pending_action='message' OR `+managedIncomingSQL+` THEN 0 WHEN m.pending_task_id<>'' THEN 1 ELSE 2 END,m.next_run_at,m.agent_id LIMIT 100`, repliesOnly, now.UnixMilli(), now.Add(-10*time.Minute).UnixMilli(), local.Format("2006-01-02")).Scan(&candidates).Error
		if err != nil {
			return err
		}
		for _, candidate := range candidates {
			if candidate.PriorityReply {
				candidate.Action = "message"
			}
			var number string
			if err := tx.Raw(`SELECT account_number::text FROM human_accounts WHERE uid=?`, candidate.SponsorUID).Scan(&number).Error; err != nil {
				return err
			}
			if !managedAdminOwner(tx, candidate.SponsorUID, number) {
				continue
			}
			var campaign managedCampaign
			if err := tx.Raw(`SELECT * FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE`, candidate.SponsorUID).Scan(&campaign).Error; err != nil {
				return err
			}
			var spent int64
			if err := tx.Raw(`SELECT COALESCE(sum(charged_fen),0) FROM managed_runs WHERE sponsor_uid=? AND month=?`, candidate.SponsorUID, local.Format("2006-01")).Scan(&spent).Error; err != nil {
				return err
			}
			reserve := managedCost(managedMaxInput, managedMaxOutput, candidate.InputRate, candidate.OutputRate)
			if !campaign.Enabled || reserve <= 0 || spent+reserve > campaign.MonthlyBudgetFen {
				continue
			}
			topicKey := ""
			if candidate.Topic != "" && candidate.RecipientID == 0 {
				topicKey = managedTextKey(candidate.Topic)
			}
			if topicKey != "" && candidate.Action == "" {
				var used bool
				if err := tx.Raw("SELECT EXISTS(SELECT 1 FROM managed_runs WHERE sponsor_uid=? AND topic_key=? AND created_at>? AND (status='published' OR (status='running' AND created_at>?)))", candidate.SponsorUID, topicKey, now.Add(-24*time.Hour).UnixMilli(), now.Add(-5*time.Minute).UnixMilli()).Scan(&used).Error; err != nil {
					return err
				}
				if used {
					candidate.Topic = ""
					topicKey = ""
				}
			}
			runID, err := s.idgen.NextID()
			if err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at,provider_host,model,topic_key,requested_action,task_id,task_digest) VALUES(?,?,?,?::date,?,'running',?,?,?,?,?,?,?,?,?)`, runID, candidate.AgentID, candidate.SponsorUID, local.Format("2006-01-02"), local.Format("2006-01"), reserve, reserve, now.UnixMilli(), managedProvider(), os.Getenv("LLM_MODEL"), topicKey, candidate.Action, candidate.TaskID, candidate.TaskDigest).Error; err != nil {
				return err
			}
			// Stable spread avoids synchronized waves. Attempts, including failures and
			// skips, count against the daily limit; manual queue cannot bypass it.
			next := now.Add(time.Duration(90+managedVariation(candidate.AgentID, runID, "interval")%61) * time.Minute).UnixMilli()
			if err := tx.Exec(`UPDATE managed_members SET next_run_at=?,pending_topic='',pending_recipient_id=NULL,pending_action='',pending_task_id='',pending_task_digest='' WHERE agent_id=?`, next, candidate.AgentID).Error; err != nil {
				return err
			}
			candidate.RunID = runID
			candidate.Reserved = reserve
			job = &candidate
			break
		}
		return nil
	})
	return job, err
}
func (s *Service) managedLoop() {
	go s.managedReplyLoop()
	go s.managedDispatchLoop()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		notifyCtx, notifyCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := s.notifyManagedMessages(notifyCtx); err != nil {
			slog.Warn("managed notifications pending")
		}
		notifyCancel()
		reportCtx, reportCancel := context.WithTimeout(context.Background(), 10*time.Second)
		reportErr := s.persistManagedDaily(reportCtx, time.Now())
		reportCancel()
		if !managedModelConfigured() {
			s.managedBeat("model_unconfigured")
			continue
		}
		if reportErr != nil {
			s.managedBeat("report_failed")
		} else {
			s.managedBeat("ready")
		}

	}
}

// A slow public generation must not hold every incoming private reply behind
// the bulk queue. Claims and billing still share the same database locks.
func (s *Service) managedReplyLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if !managedModelConfigured() {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 210*time.Second)
		job, err := s.claimManagedMode(ctx, time.Now(), true)
		if err == nil && job != nil {
			s.executeManaged(ctx, *job)
		}
		cancel()
	}
}

type managedOutput struct {
	Tool             string             `json:"tool,omitempty"`
	Arguments        activityRequest    `json:"arguments,omitempty"`
	Pending          string             `json:"pending,omitempty"`
	WritingCard      managedWritingCard `json:"writing_card"`
	Review           managedReview      `json:"review"`
	Action           string             `json:"action"`
	Document         socialDocument     `json:"document"`
	PostID           string             `json:"post_id"`
	Content          string             `json:"content"`
	PhotoQuery       string             `json:"photo_query"`
	PhotoSubject     string             `json:"photo_subject"`
	SourceIDs        []string           `json:"source_ids"`
	ReplyToCommentID string             `json:"reply_to_comment_id"`
	RecipientID      string             `json:"recipient_id"`
	ConversationID   string             `json:"conversation_id"`
	ReplyToMessageID string             `json:"reply_to_message_id"`
}
type managedModelResult struct {
	WritingTrace          managedWritingTrace
	Calls, Repairs        int
	ReviewStatus          string
	UnknownReserved       int64
	Requested, UsageKnown bool
	Value                 managedOutput
	Input, Output         int64
	Sources               []managedSource
	Photo                 managedPhoto
	Targets               managedTargets
}

func callManagedModel(ctx context.Context, input any) (managedModelResult, error) {
	prompt := managedPrompt
	if payload, ok := input.(map[string]any); ok && payload["activity_mode"] == true {
		return callManagedModelWithPrompt(ctx, input, managedActivityPrompt())
	}
	if payload, ok := input.(map[string]any); ok && payload["presence_brief"] != nil {
		prompt = managedPilotPrompt()
	}
	return callManagedModelWithPrompt(ctx, input, prompt)
}
func callManagedModelWithPrompt(ctx context.Context, input any, prompt string) (managedModelResult, error) {
	result := managedModelResult{}
	if !strings.Contains(prompt, companionpolicy.Identity) {
		prompt = companionpolicy.Identity + prompt
	}
	// Apply after selecting the writer/reviewer prompt so other writing modes
	// cannot replace celebrity constraints, including on repair requests.
	if payload, ok := input.(map[string]any); ok && payload["celebrity_profile"] != nil {
		prompt += celebrityWritingPrompt + celebrityIdentityPrompt
	}
	endpoint, ok := managedModelURL()
	if !ok {
		return result, managedFailure("configuration")
	}
	data, err := json.Marshal(input)
	if err != nil || len(data)+len(prompt) > managedMaxInput-1000 || socialSecretPattern.Match(data) {
		return result, managedFailure("input")
	}
	payload := map[string]any{"model": os.Getenv("LLM_MODEL"), "messages": []map[string]string{{"role": "system", "content": prompt}, {"role": "user", "content": string(data)}}, "max_tokens": managedMaxOutput, "temperature": managedTemperature(), "response_format": map[string]string{"type": "json_object"}, "stream": false}
	providerURL, _ := url.Parse(endpoint)
	if providerURL.Hostname() == "api.deepseek.com" {
		// DeepSeek defaults to thinking; bounded social replies use non-thinking
		// so the output allowance remains available for the actual JSON content.
		payload["thinking"] = map[string]string{"type": "disabled"}
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, managedFailure("request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("LLM_API_KEY"))
	client := &http.Client{Timeout: 180 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	result.Requested = true
	res, err := client.Do(req)
	if err != nil {
		var networkError net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
			return result, managedFailure("provider_timeout")
		}
		return result, managedFailure("provider_network")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		result.UsageKnown = res.StatusCode >= 400 && res.StatusCode < 500
		return result, managedFailure("provider_" + strconv.Itoa(res.StatusCode))
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		var networkError net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
			return result, managedFailure("provider_timeout")
		}
		return result, managedFailure("response")
	}
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Finish string `json:"finish_reason"`
		} `json:"choices"`
		Usage *struct {
			Input  int64 `json:"prompt_tokens"`
			Output int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return result, managedFailure("output")
	}
	if envelope.Usage != nil {
		result.Input, result.Output = envelope.Usage.Input, envelope.Usage.Output
	}
	if result.Input < 0 || result.Output < 0 || result.Input > managedMaxInput || result.Output > managedMaxOutput {
		result.Input, result.Output = 0, 0
		return result, managedFailure("usage")
	}
	result.UsageKnown = envelope.Usage != nil
	if len(envelope.Choices) == 1 && envelope.Choices[0].Finish == "length" {
		return result, managedFailure("output_length")
	}
	if len(envelope.Choices) != 1 || envelope.Choices[0].Finish != "stop" || socialSecretPattern.MatchString(envelope.Choices[0].Message.Content) || managedDecodeModelOutput(envelope.Choices[0].Message.Content, &result.Value) != nil {
		return result, managedFailure("output")
	}
	// These roles create discussion prompts, not verified project results.
	// Classification is server-owned; a model's invented kind must not make
	// otherwise valid discussion content impossible to publish.
	if result.Value.Action == "post" && result.Value.Document.Kind != "result" {
		result.Value.Document.Kind = "question"
		result.Value.Document.Media = nil
		if len(result.Value.Document.Tags) == 0 {
			result.Value.Document.Tags = []string{"话题讨论"}
		}
	}
	return result, nil
}

// Stable per-thread interest keeps every role from eventually visiting every post.
// Run-specific cadence varies between attempts without exposing random fake counts.
func managedVariation(agentID, eventID int64, purpose string) int64 {
	digest := sha256.Sum256([]byte(fmtRun(agentID) + ":" + fmtRun(eventID) + ":" + purpose))
	return int64(binary.BigEndian.Uint64(digest[:8]) & 0x7fffffffffffffff)
}
func managedInterested(agentID, postID int64) bool {
	threshold := 30 + managedVariation(0, postID, "appeal")%41
	return managedVariation(agentID, postID, "interest")%100 < threshold
}

func (s *Service) executeManaged(ctx context.Context, job managedJob) {
	input, err := s.managedContext(ctx, job)
	if err != nil {
		s.finishManagedFailure(job, managedModelResult{}, managedFailure("context"))
		return
	}
	if (job.RecipientID > 0 || job.Action == "message") && input.Message == nil {
		s.db.WithContext(ctx).Exec("UPDATE managed_runs SET status='skipped',detail='私信对象不可用、等待回复或未开启权限',charged_fen=0,finished_at=? WHERE run_id=? AND status='running'", time.Now().UnixMilli(), job.RunID)
		return
	}
	sources := []managedSource{}
	if celebrityForJob(job) != nil {
		// Public news also grounds private questions about the figure's recent
		// activity. Read directly: a DM must not reserve a public-post source slot.
		sources, err = s.celebritySources(ctx, job)
	} else if !input.Targets.Private {
		sources = s.managedSources(ctx, job.Scenario)
	}
	if err != nil {
		s.finishManagedFailure(job, managedModelResult{}, managedFailure("context"))
		return
	}
	topic := job.Topic
	if input.Targets.Private {
		topic = ""
	}
	payload := map[string]any{"agent_identity": job.identitySnapshot(), "context": input, "web_sources": sources, "name": job.Name, "character_brief": job.characterBrief(), "scenario": job.Scenario, "operator_topic": topic, "angle_hint": managedAngle(job), "writing_brief": managedWritingBrief(job.AgentID, job.RunID), "media_brief": managedMediaBrief(job.AgentID, job.RunID), "date": time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")}
	if p := celebrityForJob(job); p != nil {
		// One coherent writing policy; ordinary-role style lotteries can conflict
		// with the public figure's source-grounded voice.
		delete(payload, "writing_brief")
		delete(payload, "angle_hint")
		payload["celebrity_profile"] = p
		var background struct {
			Background          string
			BackgroundCheckedAt int64
		}
		if e := s.db.WithContext(ctx).Raw("SELECT background,background_checked_at FROM managed_public_sources WHERE sponsor_uid=? AND source_key=?", job.SponsorUID, p.Key).Scan(&background).Error; e != nil {
			s.finishManagedFailure(job, managedModelResult{}, managedFailure("context"))
			return
		}
		payload["public_background"] = background
		payload["original_samples"] = s.celebrityOriginalSamples(ctx, job)
		var documents string
		if s.db.WithContext(ctx).Raw(`SELECT background_documents::text FROM managed_public_sources WHERE sponsor_uid=? AND source_key=?`, job.SponsorUID, p.Key).Scan(&documents).Error == nil {
			var sources []any
			_ = json.Unmarshal([]byte(documents), &sources)
			payload["background_documents"] = sources
		}
	}
	if input.Targets.Private {
		payload["message_brief"] = job.Topic
	}
	if celebrityForJob(job) == nil {
		payload["perspective_brief"] = managedPerspective(job, 0)
	}
	payload["required_action"] = job.Action
	if input.Targets.Private {
		payload["required_action"] = "message"
	}
	managedApplyPresence(payload, job)
	writerInput := managedGenerationContext(input, job.Action == "post")
	writerInput = managedPresenceWriterContext(writerInput, job)
	if !managedFitInput(payload, &writerInput) {
		s.finishManagedFailure(job, managedModelResult{}, managedFailure("input"))
		return
	}
	result, err := s.managedActivityModel(ctx, &job, payload, &input)
	result.Sources = sources
	result.Targets = input.Targets
	if err == nil && input.Targets.Private {
		if result.Value.Action == "message" {
			managedBindMessageTarget(&result.Value, input.Message)
		} else if result.Value.Action != "skip" {
			err = managedFailure("task_action")
		}
	}
	if err == nil && job.Action != "" && result.Value.Action != job.Action && result.Value.Action != "skip" {
		err = managedFailure("task_action")
	}
	if err == nil && result.Value.Action == "post" {
		err = s.reviewManagedDraft(ctx, &job, &result, payload)
	}
	if !input.Targets.Private {
		if raw, e := json.Marshal(sources); e == nil {
			s.db.WithContext(ctx).Exec("UPDATE managed_runs SET source_snapshot=?::jsonb WHERE run_id=?", string(raw), job.RunID)
		}
	}
	if err == nil && result.Value.Action == "post" && !input.Targets.Private && managedWritingIssue(result.Value) == "" && managedPhotoGrounded(result.Value) && managedWantsPhoto(job.AgentID, job.RunID, result.Value.PhotoQuery) {
		var used []string
		err = s.db.WithContext(ctx).Raw("SELECT source_page FROM managed_photo_usage").Scan(&used).Error
		if err == nil {
			excluded := map[string]bool{}
			for _, page := range used {
				excluded[page] = true
			}
			result.Photo, err = selectManagedPhoto(ctx, result.Value.Document, job.Scenario, result.Value.PhotoQuery, job.RunID, excluded)
		}
	}
	if err != nil {
		s.finishManagedFailure(job, result, err)
		return
	}
	eligible := map[int64]bool{}
	for _, p := range input.Posts {
		eligible[socialDecimal(p.ID)] = true
	}
	if err = s.commitManaged(ctx, job, result, eligible); err != nil {
		s.finishManagedFailure(job, result, err)
	} else {
		s.managedActivityCheckpoint(ctx, job, result)
	}
}
func (s *Service) commitManaged(ctx context.Context, job managedJob, result managedModelResult, eligible map[int64]bool) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current struct {
			Enabled  bool
			Revision int64
		}
		var campaign managedCampaign
		// Same ordering as campaign edits: pause waits for this short commit only.
		if err := tx.Raw(`SELECT * FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE`, job.SponsorUID).Scan(&campaign).Error; err != nil {
			return err
		}
		if err := tx.Raw(`SELECT m.enabled AND m.deleted_at=0 AND a.identity_state='active' AS enabled,m.revision FROM managed_members m JOIN agents a USING(agent_id) WHERE m.agent_id=? FOR UPDATE`, job.AgentID).Scan(&current).Error; err != nil {
			return err
		}
		var status string
		if err := tx.Raw(`SELECT status FROM managed_runs WHERE run_id=? FOR UPDATE`, job.RunID).Scan(&status).Error; err != nil {
			return err
		}
		if status != "running" {
			return errConflict
		}
		value := result.Value
		var sponsorNumber string
		if err := tx.Raw(`SELECT account_number::text FROM human_accounts WHERE uid=?`, job.SponsorUID).Scan(&sponsorNumber).Error; err != nil {
			return err
		}
		detail := ""
		status = "skipped"
		var postID any
		var messageID, conversationID any
		if !current.Enabled || !campaign.Enabled || current.Revision != job.Revision || !managedAdminOwner(tx, job.SponsorUID, sponsorNumber) {
			value.Action = "skip"
			detail = "角色已暂停或资料已更新，未发布"
		}
		if !celebrityOutputAllowed(job, value) {
			value.Action = "skip"
			detail = "代理身份表达未通过检查，未发布"
		}
		if issue := managedWritingIssue(value); issue != "" {
			value.Action = "skip"
			detail = issue
		}
		if result.Targets.Private && value.Action != "message" && value.Action != "skip" {
			value.Action = "skip"
			detail = "私信轮次不发布公共内容"
		}
		if job.Action != "" && value.Action != job.Action && value.Action != "skip" {
			return managedFailure("task_action")
		}
		if result.ReviewStatus != "" && result.ReviewStatus != "ok" && value.Action == "skip" && detail == "" {
			detail = managedReviewReasonText(result.ReviewStatus) + "，本轮保持安静"
		}
		if value.Action == "skip" && detail == "" && value.Pending != "" && !result.Targets.Private {
			detail = managedClip(value.Pending, 240)
		}
		if value.Action == "post" {
			d := value.Document
			d.Identity = "agent"
			d.ProjectName = ""
			d.OrganizationID = ""
			d.Media = []socialMedia{}
			if len(value.SourceIDs) > 1 {
				return managedFailure("content_source")
			}
			for _, sourceID := range value.SourceIDs {
				found := false
				for _, source := range result.Sources {
					if source.ID == sourceID && managedSourceURL(source.URL) {
						found = true
						break
					}
				}
				if !found {
					return managedFailure("content_source")
				}
			}
			if len(value.SourceIDs) == 0 && (strings.Contains(d.Body, "今日最新") || strings.Contains(d.Body, "刚刚发布")) {
				return managedFailure("content_source")
			}
			if d.Kind == "result" || utf8.RuneCountInString(d.Body) > 1200 || strings.Contains(d.Body, "http") {
				return managedFailure("content_schema")
			}
			if err := validateSocialDocument(&d, "public"); err != nil {
				return managedFailure(managedDocumentFailure(d))
			}
			blocked, _ := socialPreflight(d)
			publicContent, _ := json.Marshal(d)
			if len(blocked) > 0 || socialPrivatePattern.Match(publicContent) || managedPrivatePattern.Match(publicContent) {
				return managedFailure("content_safety")
			}
			var duplicate bool
			if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_work_posts WHERE agent_id=? AND document->>'title'=? AND created_at>?)`, job.AgentID, d.Title, time.Now().Add(-7*24*time.Hour).UnixMilli()).Scan(&duplicate).Error; err != nil {
				return err
			}
			var recentTitles []string
			if err := tx.Raw(`SELECT p.document->>'title' FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE m.sponsor_uid=? AND p.state='published' AND p.visibility='public' AND p.created_at>? ORDER BY p.created_at DESC LIMIT 80`, job.SponsorUID, time.Now().Add(-30*24*time.Hour).UnixMilli()).Scan(&recentTitles).Error; err != nil {
				return err
			}
			for _, title := range recentTitles {
				if managedTitleKey(title) == managedTitleKey(d.Title) || managedSimilarTitle(title, d.Title) {
					duplicate = true
				}
			}
			if !duplicate {
				var e error
				duplicate, e = managedDuplicateBody(tx, job, d.Body)
				if e != nil {
					return e
				}
			}
			if duplicate {
				detail = "与近期内容重复，跳过发布"
			} else {
				if err := s.addManagedPhoto(tx, job.AgentID, &d, result.Photo); err != nil {
					return err
				}
				raw, _ := json.Marshal(socialWriteRequest{Document: d, Visibility: "public", OwnerAuthorized: true, IdempotencyKey: "managed:" + fmtRun(job.RunID)})
				child := *s
				child.db = tx
				receipt, e := child.activityTool(ctx, job.AgentID, "publish", activityRequest{Key: "managed:" + fmtRun(job.RunID) + ":publish", Data: raw})
				if e != nil {
					return e
				}
				if receipt.Status != 201 {
					return managedFailure("publication")
				}
				data := activityData(receipt)
				id := socialDecimal(activityString(data, "id"))
				if id == 0 || activityString(data, "state") != "published" {
					return managedFailure("publication")
				}
				postID = id
				status = "published"
			}
		} else if value.Action == "comment" {
			var err error
			copyResult := result
			copyResult.Value = value
			status, detail, err = s.commitManagedComment(ctx, tx, job, copyResult, eligible)
			if err != nil {
				return err
			}
			if status == "commented" {
				postID = socialDecimal(value.PostID)
			}
		} else if value.Action == "like" {
			id := socialDecimal(value.PostID)
			if !eligible[id] || (result.Targets.Enforced && !result.Targets.Likes[id]) {
				return managedFailure("target")
			}
			scoped := *s
			scoped.db = tx
			if err := tx.Exec(`SELECT post_id FROM social_work_posts WHERE post_id=? FOR UPDATE`, id).Error; err != nil {
				return err
			}
			row, err := scoped.socialRead(ctx, job.AgentID, id)
			if err != nil || row.State != "published" || row.Visibility != "public" {
				return errConflict
			}
			allowed, err := managedPublicTarget(tx, job, row.AgentID)
			if err != nil {
				return err
			}
			if !allowed {
				return managedFailure("target")
			}
			available, err := managedOwnerInteractionAvailable(tx, job, id, row.AgentID, "like")
			if err != nil {
				return err
			}
			if available && !row.Liked {
				receipt, e := scoped.activityTool(ctx, job.AgentID, "react", activityRequest{ID: fmtRun(id), Key: "managed:" + fmtRun(job.RunID) + ":react", Data: json.RawMessage(`{"kind":"like","active":true}`)})
				if e != nil {
					return e
				}
				if receipt.Status != 200 {
					return managedFailure("publication")
				}
				postID = id
				status = "liked"
			} else {
				detail = "已点赞或已有角色表达支持，跳过重复操作"
			}
		} else if value.Action == "message" {
			copyResult := result
			copyResult.Value = value
			msg, conv, reason, err := s.commitManagedMessage(tx, job, copyResult)
			if err != nil {
				return err
			}
			detail = reason
			if msg > 0 {
				messageID, conversationID = msg, conv
				status = "messaged"
			}
		} else if value.Action != "skip" {
			return managedFailure("output")
		}
		// An intentional quiet response is a completed decision too. Do not pay
		// to reconsider the same incoming message every subsequent schedule.
		if result.Targets.Private && result.Value.Action == "skip" && value.Action == "skip" && detail == "" {
			for peer, target := range result.Targets.Messages {
				if err := tx.Exec(`INSERT INTO managed_message_receipts(run_id,sender_id,receiver_id,conv_id,trigger_key,decision,created_at,notified_at) VALUES(?,?,?,NULLIF(?::bigint,0),?,'skipped',?,?) ON CONFLICT(sender_id,trigger_key) DO NOTHING`, job.RunID, job.AgentID, peer, socialDecimal(target.ConversationID), target.TriggerKey, time.Now().UnixMilli(), time.Now().UnixMilli()).Error; err != nil {
					return err
				}
			}
		}
		cost := managedResultCost(job, result)
		// A tool may have completed an action before the model ended quietly.
		// Actual publication progress is always read from social_work_posts.
		if status == "skipped" {
			var prior struct {
				Tool string
				Post string
			}
			if err := tx.Raw(`SELECT tool,COALESCE(result->'data'->>'id',result->'data'->>'post_id','') AS post FROM agent_activity_receipts WHERE agent_id=? AND operation_key LIKE ? AND tool IN ('publish','comment','react') ORDER BY created_at DESC LIMIT 1`, job.AgentID, "managed:"+fmtRun(job.RunID)+":tool:%").Scan(&prior).Error; err != nil {
				return err
			}
			if prior.Tool != "" {
				status = map[string]string{"publish": "published", "comment": "commented", "react": "liked"}[prior.Tool]
				detail = "已完成动作并核验回执。"
				if value.Pending != "" {
					detail += managedClip(value.Pending, 220)
				}
				if id := socialDecimal(prior.Post); id > 0 {
					postID = id
				}
			}
		}
		return tx.Exec(`UPDATE managed_runs SET status=?,detail=?,charged_fen=?,input_tokens=?,output_tokens=?,post_id=?,message_id=?,conversation_id=?,finished_at=?,model_calls=?,repair_count=?,review_status=?,writing_trace=?::jsonb WHERE run_id=?`, status, detail, cost, result.Input, result.Output, postID, messageID, conversationID, time.Now().UnixMilli(), result.Calls, result.Repairs, result.ReviewStatus, managedTraceJSON(result.WritingTrace), job.RunID).Error
	})
}

// Relevant media is selected by content; a random turn number must not veto it.
func managedWantsPhoto(agent, run int64, query string) bool {
	return managedPhotoQuery.MatchString(strings.TrimSpace(query))
}
func managedMediaBrief(agent, run int64) string {
	return "把正文与配图一起考虑，选出能让读者看见具体对象和情境的 photo_subject 与 photo_query，交由服务端实际检索；本站此调用只有图片检索能力，不具备宿主附件读取或生图能力。找不到相关素材时保留文字，来源不冒充角色亲历。"
}
