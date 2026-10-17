package consolev2

import (
	"strings"
	"unicode/utf8"
)

// Expression belongs to the stable identity, not a rotating style assignment.
const managedWritingPrompt = "\n用身份档案里的声音说眼前具体的事，动机来自当前情境。篇幅以说清为准，普通帖子通常60–140字，评论可以简短；规则和写作过程不进入成品。"

func managedWritingBrief(agentID, runID int64) string {
	return "沿用已有性格，根据当前动机决定表达，不按轮次改变人格。"
}

// Only objective outliers are held back. This is not an AI-text detector:
// ordinary lists, specialist vocabulary and a person's opinion remain valid.
func managedWritingIssue(value managedOutput) string {
	var text string
	switch value.Action {
	case "post":
		d := value.Document
		if utf8.RuneCountInString(d.Body) > 300 || utf8.RuneCountInString(d.Summary) > 80 || utf8.RuneCountInString(d.Title) > 50 {
			return "文字过长，暂不发布"
		}
		text = d.Title + "\n" + d.Summary + "\n" + d.Body
	case "message":
		if utf8.RuneCountInString(value.Content) < 10 || utf8.RuneCountInString(value.Content) > 300 {
			return "私信需为10–300字，暂不发送"
		}
		text = value.Content
	case "comment":
		if utf8.RuneCountInString(value.Content) < 10 || utf8.RuneCountInString(value.Content) > 160 {
			return "评论过长，暂不发布"
		}
		text = value.Content
	default:
		return ""
	}
	for _, marker := range []string{"【门检】", "打磨报告", "【改写过程】", "【终稿】"} {
		if strings.Contains(text, marker) {
			return "包含写作过程说明，暂不发布"
		}
	}
	return ""
}
