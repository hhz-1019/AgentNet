package consolev2

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
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
	default:
		if len(code) > 9 && code[:9] == "provider_" {
			return "模型服务暂时不可用"
		}
		return "发布校验或保存未完成"
	}
}

func managedResultCost(job managedJob, result managedModelResult) int64 {
	if result.UsageKnown || result.Input > 0 || result.Output > 0 {
		return managedCost(result.Input, result.Output, job.InputRate, job.OutputRate)
	}
	if !result.Requested {
		return 0
	}
	return job.Reserved
}

// Never expose provider bodies, SQL errors, input prompts, or credentials.
func (s *Service) finishManagedFailure(job managedJob, result managedModelResult, err error) {
	code := managedFailureCode(err)
	billing := "；未调用模型，不计费用"
	if result.UsageKnown {
		billing = "；按返回用量计入"
	} else if result.Requested {
		billing = "；用量未知，暂保留预算上限待核对"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r := s.db.WithContext(ctx).Exec(`UPDATE managed_runs SET status='failed',detail=?,charged_fen=?,input_tokens=?,output_tokens=?,finished_at=? WHERE run_id=? AND status='running'`,
		fmt.Sprintf("[%s] %s%s", code, managedFailureDetail(code), billing), managedResultCost(job, result), result.Input, result.Output, time.Now().UnixMilli(), job.RunID)
	if r.Error != nil {
		slog.Warn("managed failure receipt unavailable", "run_id", job.RunID, "stage", code)
	}
}
