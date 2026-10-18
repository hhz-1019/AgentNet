package consolev2

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"
)

type managedRunError struct{ Code string }

func (e managedRunError) Error() string { return "managed " + e.Code + " failed" }

func managedFailureCode(err error) string {
	var failure managedRunError
	if errors.As(err, &failure) {
		return failure.Code
	}
	return "publish"
}

func managedFailureDetail(code string) string {
	switch code {
	case "configuration":
		return "模型配置不完整，未发送请求"
	case "input":
		return "模型输入超限或包含敏感内容，未发送请求"
	case "request":
		return "模型请求构建失败，未发送请求"
	case "provider_timeout":
		return "模型服务响应超时，未取得完整结果"
	case "provider_network":
		return "模型服务连接失败"
	case "provider_401", "provider_403":
		return "模型服务拒绝凭证，请检查访问权限"
	case "provider_402":
		return "模型服务余额不足"
	case "provider_429":
		return "模型服务限流，等待后续调度"
	case "provider_400", "provider_404":
		return "模型服务拒绝请求，请检查模型名称与接口"
	case "response":
		return "模型响应未完整读取"
	case "output_length":
		return "模型输出被截断，未发布"
	case "output":
		return "模型输出格式不符合发帖协议，未发布"
	case "usage":
		return "模型用量回执异常，待核对"
	case "context":
		return "帖子上下文读取失败，未发送模型请求"
	case "photo":
		return "配图状态读取失败，未发布"
	case "content_title":
		return "模型生成的标题字数不符合要求，未发布"
	case "content_summary":
		return "模型生成的摘要字数不符合要求，未发布"
	case "content_body":
		return "模型生成的正文字数不符合要求，未发布"
	case "content_tags":
		return "模型生成的标签为空、重复或超限，未发布"
	case "content_source":
		return "模型引用了未提供的来源或缺少时效依据，未发布"
	case "content_safety":
		return "内容未通过公开范围与隐私检查，未发布"
	case "content_schema":
		return "模型生成的内容字段不符合发布协议，未发布"
	case "target":
		return "模型选择的互动对象不在本轮允许范围内，未发送"
	case "task_action":
		return "未生成本次安排的内容类型，未发送"
	case "activity_paused":
		return "活动已暂停或结束，未发布"
	case "review_output", "content_quality":
		return "内容检查未完成，未发布"
	default:
		if len(code) > 9 && code[:9] == "provider_" {
			return "模型服务暂时不可用"
		}
		return "发布校验或保存未完成"
	}
}

// Store only field categories, never raw drafts, provider bodies or DB errors.
func managedDocumentFailure(d socialDocument) string {
	if n := utf8.RuneCountInString(d.Title); n < 4 || n > 100 {
		return "content_title"
	}
	if n := utf8.RuneCountInString(d.Summary); n < 10 || n > 400 {
		return "content_summary"
	}
	if n := utf8.RuneCountInString(d.Body); n < 30 || n > 20000 {
		return "content_body"
	}
	if len(d.Tags) < 1 || len(d.Tags) > 8 {
		return "content_tags"
	}
	seen := map[string]bool{}
	for _, tag := range d.Tags {
		tag = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(tag, "#")))
		if tag == "" || utf8.RuneCountInString(tag) > 30 || seen[tag] {
			return "content_tags"
		}
		seen[tag] = true
	}
	return "content_schema"
}

// Historical schema compatibility; no new fee records are calculated.

// Never expose provider bodies, SQL errors, input prompts, or credentials.
func (s *Service) finishManagedFailure(job managedJob, result managedModelResult, err error) {
	code := managedFailureCode(err)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	detail := managedFailureDetail(code)
	var completed int64
	if e := s.db.WithContext(ctx).Raw("SELECT count(*) FROM agent_activity_receipts WHERE agent_id=? AND operation_key LIKE ? AND tool<>'checkpoint' AND status>=200 AND status<400", job.AgentID, "managed:"+fmtRun(job.RunID)+":%").Scan(&completed).Error; e == nil && completed > 0 {
		detail = fmt.Sprintf("已完成 %d 个动作并保留回执；%s", completed, strings.ReplaceAll(detail, "未发布", "后续步骤未完成"))
	}
	if completed > 0 {
		result.Value.Pending = fmt.Sprintf("本轮在%s阶段中断。先读取本轮已保存回执，再接续尚未完成的事情；不要重复已完成动作。", code)
		s.managedActivityCheckpoint(ctx, job, result)
	}
	r := s.db.WithContext(ctx).Exec(`UPDATE managed_runs SET status='failed',detail=?,charged_fen=?,input_tokens=?,output_tokens=?,finished_at=?,model_calls=?,repair_count=?,review_status=?,writing_trace=?::jsonb WHERE run_id=? AND status='running'`,
		fmt.Sprintf("[%s] %s", code, detail), 0, 0, 0, time.Now().UnixMilli(), result.Calls, result.Repairs, result.ReviewStatus, managedTraceJSON(result.WritingTrace), job.RunID)
	if r.Error != nil {
		slog.Warn("managed failure receipt unavailable", "run_id", job.RunID, "stage", code)
	}
}
