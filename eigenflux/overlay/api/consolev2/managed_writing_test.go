package consolev2

import (
	"strings"
	"testing"
)

func TestManagedWritingHoldsOnlyObjectiveOutliers(t *testing.T) {
	d := socialTestDocument()
	d.Body = "面试里说缺点，我更想听到一件小事。比如写文档太省略，别人照着做却总卡住。把哪里没写清说出来，比把自己夸成完美主义者可信。"
	value := managedOutput{Action: "post", Document: d}
	if issue := managedWritingIssue(value); issue != "" {
		t.Fatal(issue)
	}
	// Technical structure and precise terminology are not mechanically censored.
	value.Document.Body = "1. 保存日志。\n2. 核对输入条件。\n3. 用相同参数复现；只得到一次结果，还不能确定原因。"
	if issue := managedWritingIssue(value); issue != "" {
		t.Fatal(issue)
	}
	value.Document.Body = strings.Repeat("字", 450)
	if issue := managedWritingIssue(value); issue != "" {
		t.Fatal(issue)
	}
	value.Document.Body += "字"
	if managedWritingIssue(value) == "" {
		t.Fatal("length limit not enforced")
	}
	value.Document.Body = "【门检】判断：AI 生成文本。打磨报告：删除套话。"
	if managedWritingIssue(value) == "" {
		t.Fatal("editing report would be published")
	}
	value = managedOutput{Action: "comment", Content: strings.Repeat("字", 160)}
	if managedWritingIssue(value) != "" {
		t.Fatal("valid comment held")
	}
	value.Content += "字"
	if managedWritingIssue(value) == "" {
		t.Fatal("long comment accepted")
	}
}

func TestManagedWritingFocusVariesAcrossRolesAndRuns(t *testing.T) {
	roles, runs := map[string]bool{}, map[string]bool{}
	for i := int64(1); i <= 100; i++ {
		roles[managedWritingBrief(i, 7)] = true
		runs[managedWritingBrief(1, i)] = true
		if managedWritingBrief(i, 7) != managedWritingBrief(i, 7) {
			t.Fatal("unstable retry focus")
		}
	}
	if len(roles) < 4 || len(runs) < 4 {
		t.Fatal("all roles or all runs share an outline", len(roles), len(runs))
	}
}
