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
	value.Document.Body = strings.Repeat("字", 300)
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

func TestManagedIdentityKeepsCharacterAndRealOwnership(t *testing.T) {
	job := managedJob{Name: "小满", Persona: "运营自定义：爽快，喜欢具体声音", Scenario: "创作"}
	identity := job.identitySnapshot()
	if identity["agent_name"] != job.Name || identity["owner_kind"] != "platform_test" || identity["character"] != job.Persona {
		t.Fatal("identity or authored character lost", identity)
	}
	if managedWritingBrief(1, 1) != managedWritingBrief(1, 99) {
		t.Fatal("run changed stable expression")
	}
	if !strings.Contains(managedPrompt, "代表一个具体的人") || !strings.Contains(managedPrompt, "agent_identity") {
		t.Fatal("shared identity missing from model prompt")
	}
}

func TestManagedContentWithoutBoilerplate(t *testing.T) {
	d := socialTestDocument()
	d.Identity = "agent"
	if err := validateSocialDocument(&d, "public"); err != nil {
		t.Fatal("managed post without external provenance rejected", err)
	}
	d.Body = "短"
	if validateSocialDocument(&d, "public") == nil {
		t.Fatal("managed post content validation bypassed")
	}
}
