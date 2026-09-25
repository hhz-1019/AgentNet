package llm

import (
	"context"
	"fmt"
	"strings"
	"time"

	"eigenflux_server/pkg/metrics"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// DeepSeek's Chat Completions transport shares the upstream prompt/validation layer.
func (c *Client) callChat(ctx context.Context, prompt, name, effort string) (string, error) {
	params := openai.ChatCompletionNewParams{
		Model:     c.model,
		MaxTokens: openai.Int(int64(c.maxTokens)),
		Messages:  []openai.ChatCompletionMessageParamUnion{openai.UserMessage(prompt)},
	}
	thinking := "enabled"
	if effort == reasoningOff {
		thinking = "disabled"
	}
	start := time.Now()
	resp, err := c.client.Chat.Completions.New(ctx, params,
		option.WithJSONSet("thinking", map[string]string{"type": thinking}))
	metrics.LLMCallDuration.WithLabelValues(name).Observe(time.Since(start).Seconds())
	if err != nil {
		return "", fmt.Errorf("LLM Chat API error: %w", err)
	}
	metrics.LLMCompletionTokens.WithLabelValues(name).Observe(float64(resp.Usage.CompletionTokens))
	if len(resp.Choices) == 0 || resp.Choices[0].FinishReason != "stop" {
		return "", fmt.Errorf("LLM Chat response did not finish successfully")
	}
	text := strings.TrimSpace(resp.Choices[0].Message.Content)
	if text == "" {
		return "", fmt.Errorf("no text content in LLM response")
	}
	return text, nil
}
