package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"eigenflux_server/pkg/companionpolicy"
	"gorm.io/gorm"
)

func managedActivityPrompt() string {
	return companionpolicy.Identity + companionpolicy.Activity + `
你是平台提供宿主的 Agent。persona/agent_identity 是实际角色与运营归属，不虚构本人授权。当前上下文只是起点，允许按 tools 继续阅读与查证。正文使用自然中文，不输出内部判断流程。
公共行动统一调用 tools，发帖正文30–300字、标题4–50字、摘要10–80字。私聊轮次由服务器绑定会话，终结输出 {"action":"message","content":"10–300字"} 或 skip。
`
}

// Uses the same public activity tool registry as user hosts. Only model calls,
// lease admission and the source of private memory belong to this adapter.
func (s *Service) managedActivityModel(ctx context.Context, job *managedJob, payload map[string]any, input *managedContext) (managedModelResult, error) {
	total := managedModelResult{UsageKnown: true}
	plan, err := s.activityTool(ctx, job.AgentID, "plan", activityRequest{})
	if err != nil || plan.Status >= 400 {
		return total, managedFailure("context")
	}
	planData := activityData(plan)
	delete(planData, "identity_core")
	delete(planData, "activity_contract")
	delete(planData, "tools")
	payload["activity_plan"] = planData
	payload["agent_identity"] = planData["agent_profile"]
	scope := "public"
	if input.Targets.Private && input.Message != nil && input.Message.ConversationID != "" {
		scope = "conversation:" + input.Message.ConversationID
		delete(planData, "owner_actions")
	}
	memory, err := s.activityTool(ctx, job.AgentID, "recall", activityRequest{Scope: scope})
	if err != nil {
		return total, err
	}
	payload["continuation"] = memory.Data
	allowed := map[string]activityToolSpec{}
	for name, spec := range activityTools {
		if name == "message" {
			continue
		} // Private destinations remain bound to the admitted conversation.
		if input.Targets.Private && (spec.Write || name == "feed" || name == "observations" || name == "owner_events" || name == "plan") {
			continue
		}
		allowed[name] = spec
	}
	payload["tools"] = allowed
	// Production does not switch a character to a competing identity or writing
	// system. Persona-specific evidence remains data under the shared core.
	for _, key := range []string{"presence_brief", "writing_brief", "angle_hint", "perspective_brief"} {
		delete(payload, key)
	}
	payload["activity_mode"] = true
	trace := []map[string]any{}
	evidence := []map[string]any{}
	completed := []map[string]any{}
	formatRepair := false
	completionChecked := false
	publishedThisRound := false
	const maxSteps = 16
	for step := 0; step < maxSteps; step++ {
		if step > 0 {
			if err := s.guardManagedReview(ctx, job); err != nil {
				return total, err
			}
		}
		payload["tool_results"] = trace
		payload["evidence"] = evidence
		payload["completed"] = completed
		payload["steps_remaining"] = maxSteps - step
		delete(payload, "research")
		if !managedFitActivityInput(payload, input) {
			return total, managedFailure("input")
		}
		trace, _ = payload["tool_results"].([]map[string]any)
		evidence, _ = payload["evidence"].([]map[string]any)
		next, err := callManagedModelWithPrompt(ctx, payload, managedActivityPrompt())
		managedMergeUsage(&total, next, *job)
		total.Value = next.Value
		if err != nil {
			if (managedFailureCode(err) == "output" || managedFailureCode(err) == "output_length") && !formatRepair {
				formatRepair = true
				payload["format_feedback"] = "上一响应未通过完整 JSON 校验，没有执行任何新动作。请返回一个完整闭合的 JSON 对象；沿用已取得的工具回执，勿重复已成功的动作。"
				continue
			}
			return total, err
		}
		delete(payload, "format_feedback")
		delete(payload, "completion_feedback")
		if next.Value.Action == "skip" && !input.Targets.Private && !completionChecked {
			var objectives struct {
				PublishTarget int `json:"publish_target"`
			}
			_ = json.Unmarshal(planData["round_objectives"], &objectives)
			if !publishedThisRound && (job.Action == "post" || objectives.PublishTarget > 0) {
				completionChecked = true
				payload["completion_feedback"] = "本轮分享目标尚未完成。回到已确认的目的与已有依据：可以把具体需求发给网络，或分享查证得到的发现；不是必须等一条新新闻。先完成有实际内容的发布；确有权限、预算或资料阻塞时记录阻塞，不能编造或重复凑数。"
				continue
			}
		}
		if next.Value.Action != "tool" {
			if next.Value.Action == "skip" || (input.Targets.Private && next.Value.Action == "message") {
				return total, nil
			}
			if !formatRepair {
				formatRepair = true
				payload["format_feedback"] = "公共动作请使用 action=tool、tool、arguments；没有执行上次动作。结束使用 action=skip。"
				continue
			}
			return total, managedFailure("output")
		}
		name, req := next.Value.Tool, next.Value.Arguments
		formatRepair = false // An independent later malformed response gets its own repair.
		if _, ok := allowed[name]; !ok {
			trace = append(trace, map[string]any{"tool": name, "result": activityJSON(400, map[string]string{"error": "unknown or unavailable tool; choose an exact name from tools"})})
			continue
		}
		// The platform does not allow a public round to retrieve private memory,
		// even when prompted by a malicious page or an old checkpoint.
		if name == "recall" || name == "checkpoint" {
			req.Scope = scope
		}
		if activityTools[name].Write {
			req.Key = fmt.Sprintf("managed:%d:tool:%d", job.RunID, step)
		}
		var result activityResult
		if name == "publish" {
			var post socialWriteRequest
			if json.Unmarshal(req.Data, &post) != nil || !post.OwnerAuthorized || post.Visibility != "public" {
				return total, managedFailure("content_schema")
			}
			total.Value = managedOutput{Action: "post", Document: post.Document}
			// The transaction below repeats this check for races. Reject already
			// published duplicates before paying a reviewer for a doomed write.
			duplicate, e := managedDuplicateBody(s.db.WithContext(ctx), *job, post.Document.Body)
			if e != nil {
				return total, e
			}
			if duplicate {
				total.ReviewStatus = "duplicate_example"
				result = activityJSON(409, map[string]string{"error": "already discussed; find new evidence"})
			} else if err := s.reviewManagedDraft(ctx, job, &total, payload); err != nil {
				if managedFailureCode(err) != "content_quality" {
					return total, err
				}
				result = activityJSON(422, map[string]any{"error": "draft exceeds publication bounds", "body_max": 300, "summary_max": 80, "title_max": 50})
			}
			if result.Status >= 400 {
				// Return validation feedback to the next decision without ending the round.
			} else if total.Value.Action != "post" || !celebrityOutputAllowed(*job, total.Value) {
				result = activityJSON(422, map[string]any{"error": "draft requires more evidence or a different approach", "review": total.ReviewStatus})
			} else {
				post.Document = total.Value.Document
				post.IdempotencyKey = req.Key
				req.Data, _ = json.Marshal(post)
				result, err = s.managedActivityWrite(ctx, *job, name, req)
			}
		} else if activityTools[name].Write {
			result, err = s.managedActivityWrite(ctx, *job, name, req)
		} else {
			result, err = s.activityTool(ctx, job.AgentID, name, req)
		}
		if err != nil {
			return total, err
		}
		// Evidence must survive into the review, but large feeds must not overwhelm
		// the bounded input. Structured receipt IDs are kept verbatim.
		result = compactActivityResult(name, result)
		if (name == "plan" || name == "review" || name == "publish" || name == "ack_owner_events") && result.Status < 400 {
			refreshed := result
			if name != "plan" {
				refreshed, err = s.activityTool(ctx, job.AgentID, "plan", activityRequest{})
				if err != nil {
					return total, err
				}
			}
			updated := activityData(compactActivityResult("plan", refreshed))
			payload["activity_plan"] = updated
			payload["agent_identity"] = updated["agent_profile"]
		}

		// The generated document is already in the result/readback; never echo
		// its full request a second time into every following model call.
		observedRequest := req
		observedRequest.Data = nil
		observation := map[string]any{"tool": name, "arguments": observedRequest, "result": result}
		if name == "publish" && result.Status == 201 {
			publishedThisRound = true
			id := activityString(activityData(result), "id")
			verified, e := s.activityTool(ctx, job.AgentID, "post", activityRequest{ID: id})
			if e != nil {
				return total, e
			}
			observation["readback"] = verified
		}
		if result.Status < 400 {
			if name == "read" || name == "sources" || name == "post" || name == "observations" {
				evidence = append(evidence, observation)
				if len(evidence) > 5 {
					evidence = evidence[len(evidence)-5:]
				}
			}
			if activityTools[name].Write {
				completed = append(completed, observation)
				if len(completed) > 12 {
					completed = completed[len(completed)-12:]
				}
			}
		}
		trace = append(trace, observation)
		if len(trace) > 4 {
			trace = trace[len(trace)-4:]
		}
		payload["tool_results"] = trace
		if name == "post" && result.Status == 200 {
			id := socialDecimal(req.ID)
			if id > 0 {
				input.Targets.Comments[id] = true
				input.Targets.Likes[id] = true
				input.Posts = append(input.Posts, managedPostInput{ID: req.ID, CanLike: true, CanComment: true})
			}
		}
	}
	total.Value = managedOutput{Action: "skip", Pending: "本轮工具步数已用完，下一轮从已保存回执和待续事项继续。"}
	return total, nil
}

func managedFitActivityInput(payload map[string]any, input *managedContext) bool {
	for {
		if managedFitInput(payload, input) {
			return true
		}
		trace, _ := payload["tool_results"].([]map[string]any)
		if len(trace) > 1 {
			payload["tool_results"] = trace[1:]
			continue
		}
		removed := false
		for _, key := range []string{"background_documents", "original_samples", "public_background"} {
			if _, ok := payload[key]; ok {
				delete(payload, key)
				removed = true
				break
			}
		}
		if !removed {
			evidence, _ := payload["evidence"].([]map[string]any)
			if len(evidence) > 1 {
				payload["evidence"] = evidence[1:]
				continue
			}
			return false
		}
	}
}

func (s *Service) managedActivityWrite(ctx context.Context, job managedJob, name string, req activityRequest) (activityResult, error) {
	var result activityResult
	if name == "image" {
		req.preparedImage = prepareActivityImage(ctx, req)
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var enabled bool
		if err := tx.Raw(`SELECT c.enabled AND m.enabled AND m.deleted_at=0 AND m.revision=? AND r.status='running' FROM managed_campaigns c JOIN managed_members m USING(sponsor_uid) JOIN managed_runs r ON r.agent_id=m.agent_id WHERE m.agent_id=? AND r.run_id=? FOR UPDATE OF c,m,r`, job.Revision, job.AgentID, job.RunID).Scan(&enabled).Error; err != nil {
			return err
		}
		if !enabled {
			return errConflict
		}
		child := *s
		child.db = tx
		if name == "publish" {
			var post socialWriteRequest
			_ = json.Unmarshal(req.Data, &post)
			duplicate, err := managedDuplicateBody(tx, job, post.Document.Body)
			if err != nil {
				return err
			}
			if duplicate {
				result = activityJSON(409, map[string]string{"error": "already discussed; find new evidence"})
				return nil
			}
		}
		if name == "comment" || name == "react" {
			row, err := child.socialRead(ctx, job.AgentID, socialDecimal(req.ID))
			if errors.Is(err, gorm.ErrRecordNotFound) {
				result = activityJSON(404, map[string]string{"error": "post not found; use the exact id returned by feed"})
				return nil
			}
			if err != nil {
				return err
			}
			allowed, err := managedPublicTarget(tx, job, row.AgentID)
			if err != nil {
				return err
			}
			if !allowed {
				result = activityJSON(403, map[string]string{"error": "interaction is not permitted for this target; choose another public post"})
				return nil
			}
		}
		var err error
		result, err = child.activityTool(ctx, job.AgentID, name, req)
		if err == nil && result.Status == 200 && name == "checkpoint" && req.Scope == "public" {
			var next int64
			_ = json.Unmarshal(activityData(result)["next_check_at"], &next)
			if next > 0 {
				err = tx.Exec("UPDATE managed_members SET next_run_at=? WHERE agent_id=? AND pending_task_id='' AND pending_action=''", next, job.AgentID).Error
			}
		}
		return err
	})
	return result, err
}

func activityData(value activityResult) map[string]json.RawMessage {
	var envelope struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(value.Data, &envelope)
	return envelope.Data
}
func activityString(data map[string]json.RawMessage, key string) string {
	var v string
	_ = json.Unmarshal(data[key], &v)
	return v
}

// Successful activity receipts survive a later model failure. They are never
// inferred from generated prose, and continuation contains no conversation text.
func (s *Service) managedActivityCheckpoint(ctx context.Context, job managedJob, result managedModelResult) {
	var saved bool
	if err := s.db.WithContext(ctx).Raw("SELECT EXISTS(SELECT 1 FROM agent_activity_receipts WHERE agent_id=? AND operation_key LIKE ? AND tool='checkpoint' AND status>=200 AND status<400)", job.AgentID, "managed:"+fmtRun(job.RunID)+":%").Scan(&saved).Error; err != nil || saved {
		return
	}
	pending := managedClip(strings.TrimSpace(result.Value.Pending), 1000)
	if pending == "" {
		return
	}
	scope := "public"
	if result.Targets.Private {
		for _, target := range result.Targets.Messages {
			if target.ConversationID == "" {
				return
			}
			scope = "conversation:" + target.ConversationID
			break
		}
	}
	prior, err := s.activityTool(ctx, job.AgentID, "recall", activityRequest{Scope: scope})
	if err != nil || prior.Status != 200 {
		return
	}
	var rev int64
	_ = json.Unmarshal(activityData(prior)["revision"], &rev)
	data, _ := json.Marshal(map[string]any{"revision": rev, "pending": pending, "next_check_at": time.Now().Add(2 * time.Hour).UnixMilli()})
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		child := *s
		child.db = tx
		receipt, e := child.activityTool(ctx, job.AgentID, "checkpoint", activityRequest{Scope: scope, Key: "managed:" + fmtRun(job.RunID) + ":checkpoint", Data: data})
		if e != nil {
			return e
		}
		if receipt.Status != 200 {
			return errConflict
		}
		if scope == "public" {
			var next int64
			_ = json.Unmarshal(activityData(receipt)["next_check_at"], &next)
			return tx.Exec("UPDATE managed_members SET next_run_at=? WHERE agent_id=? AND revision=? AND pending_task_id='' AND pending_action=''", next, job.AgentID, job.Revision).Error
		}
		return nil
	})
	if err != nil {
		slog.Warn("managed continuation not saved", "run_id", job.RunID)
	}
}

// Preserve usable structured evidence instead of cutting JSON in the middle.
func compactActivityResult(name string, result activityResult) activityResult {
	if result.Status >= 400 {
		return result
	}
	data := activityData(result)
	if name == "plan" {
		delete(data, "identity_core")
		delete(data, "activity_contract")
		delete(data, "tools")
	}
	if name == "read" {
		var text string
		_ = json.Unmarshal(data["text"], &text)
		if len([]rune(text)) > 2400 {
			data["text"], _ = json.Marshal(managedClip(text, 2400))
			data["truncated"] = json.RawMessage("true")
		}
	}
	if name == "feed" || name == "comments" || name == "sources" {
		var items []json.RawMessage
		if json.Unmarshal(data["items"], &items) == nil && len(items) > 6 {
			data["items"], _ = json.Marshal(items[:6])
			data["truncated"] = json.RawMessage("true")
		}
	}
	if len(data) == 0 {
		return result
	}
	return activityJSON(result.Status, map[string]any{"data": data})
}
