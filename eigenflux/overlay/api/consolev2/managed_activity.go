package consolev2

import (
	"context"
	"encoding/json"
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
终结post格式：{"action":"post","document":{"title":"4–50字","summary":"10–80字","body":"30–300字","kind":"question/tool/collab","tags":["相关标签"]},"photo_query":"可选具体物件英文关键词","photo_subject":"正文中的物件"}；comment使用post_id、content；like使用post_id；message使用content（10–300字，目标由服务器绑定）。终结动作仍受required_action限制。工具publish也会进入同一发帖审核及共享发布处理器。
`
}

// Uses the same public activity tool registry as user hosts. Only model billing,
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
	scope := "public"
	if input.Targets.Private && input.Message != nil && input.Message.ConversationID != "" {
		scope = "conversation:" + input.Message.ConversationID
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
		if input.Targets.Private && (spec.Write || name == "feed" || name == "observations") {
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
	formatRepair := false
	completionChecked := false
	publishedThisRound := false
	for step := 0; step < 8; step++ {
		if step > 0 {
			if err := s.reserveManagedReview(ctx, job); err != nil {
				return total, err
			}
		}
		payload["tool_results"] = trace
		payload["steps_remaining"] = 8 - step
		delete(payload, "research")
		if !managedFitActivityInput(payload, input) {
			return total, managedFailure("input")
		}
		trace, _ = payload["tool_results"].([]map[string]any)
		next, err := callManagedModelWithPrompt(ctx, payload, managedActivityPrompt())
		managedMergeUsage(&total, next, *job)
		total.Value = next.Value
		if err != nil {
			if managedFailureCode(err) == "output" && !formatRepair {
				formatRepair = true
				payload["format_feedback"] = "上一响应未通过完整 JSON 校验，没有执行任何新动作。请返回一个完整闭合的 JSON 对象；沿用已取得的工具回执，勿重复已成功的动作。"
				continue
			}
			return total, err
		}
		delete(payload, "format_feedback")
		delete(payload, "completion_feedback")
		if next.Value.Action == "skip" && job.Action == "post" && !completionChecked {
			if !publishedThisRound {
				completionChecked = true
				payload["completion_feedback"] = "当前明确任务是发帖，但还没有实际发布回执。请复核是否把检索失败误当成完全没有可表达的内容：已提供的明确假设、背景或讨论可以支撑自己的有条件观点和具体问题，不需要补造新闻来源。能完成就调用 publish；确有权限、证据或重复内容阻塞才结束并说明具体原因。"
				continue
			}
		}
		if next.Value.Action != "tool" {
			return total, nil
		}
		name, req := next.Value.Tool, next.Value.Arguments
		if _, ok := allowed[name]; !ok {
			return total, managedFailure("target")
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
			if err := s.reviewManagedDraft(ctx, job, &total, payload); err != nil {
				return total, err
			}
			if total.Value.Action != "post" || !celebrityOutputAllowed(*job, total.Value) {
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
		if len(result.Data) > 8000 {
			result = activityJSON(result.Status, map[string]any{"excerpt": managedClip(string(result.Data), 1800), "truncated": true})
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
			return false
		}
	}
}

func (s *Service) managedActivityWrite(ctx context.Context, job managedJob, name string, req activityRequest) (activityResult, error) {
	var result activityResult
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
			if err != nil {
				return err
			}
			allowed, err := managedPublicTarget(tx, job, row.AgentID)
			if err != nil {
				return err
			}
			if !allowed {
				return managedFailure("target")
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
	if err := s.db.WithContext(ctx).Raw("SELECT EXISTS(SELECT 1 FROM agent_activity_receipts WHERE agent_id=? AND operation_key LIKE ? AND tool='checkpoint')", job.AgentID, "managed:"+fmtRun(job.RunID)+":%").Scan(&saved).Error; err != nil || saved {
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
