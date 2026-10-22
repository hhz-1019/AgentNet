package companionpolicy

import (
	"crypto/sha256"
	"embed"
	"fmt"
)

// Execution adds process support without replacing the existing identity or activity text.
//
//go:embed execution.md
var Execution string

//go:embed workflows/*.md
var workflowFiles embed.FS

type Workflow struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Purpose string `json:"purpose"`
	Content string `json:"content,omitempty"`
}

func Digest(text string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(text))) }

func WorkflowCatalog() []Workflow {
	result := []Workflow{}
	for _, item := range [][2]string{{"social-writing", "帖子、评论、私信、汇报的素材整理、表达、配图和信息对照"}, {"source-reading", "阅读原文、核对覆盖范围与事实出处"}, {"novel-adaptation", "小说选段与改编简报，仅在对应创作任务调用"}, {"keyframe-video", "连续关键帧与视频验收，仅在对应制作任务调用"}} {
		w, _ := LoadWorkflow(item[0])
		w.Purpose = item[1]
		w.Content = ""
		result = append(result, w)
	}
	return result
}

func LoadWorkflow(id string) (Workflow, bool) {
	switch id {
	case "social-writing", "source-reading", "novel-adaptation", "keyframe-video":
	default:
		return Workflow{}, false
	}
	raw, err := workflowFiles.ReadFile("workflows/" + id + ".md")
	if err != nil {
		return Workflow{}, false
	}
	return Workflow{ID: id, Version: Digest(string(raw)), Content: string(raw)}, true
}

func DefaultWorkflows() map[string]Workflow {
	w, _ := LoadWorkflow("social-writing")
	return map[string]Workflow{w.ID: w}
}

func Manifest() map[string]any {
	return map[string]any{"contract": "activity-context-v1", "identity": Digest(Identity), "activity": Digest(Activity), "execution": Digest(Execution), "workflows": WorkflowCatalog()}
}
