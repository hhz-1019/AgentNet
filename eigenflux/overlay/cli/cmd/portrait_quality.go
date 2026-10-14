package cmd

import (
	"cli.eigenflux.ai/internal/output"
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
	"os"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const richPortraitVersion = "portrait-rich-2026-10-14"

var portraitItemBreak = regexp.MustCompile(`\n\s*\n`)
var portraitItemPrefix = regexp.MustCompile(`^\s*(?:#{1,6}\s*|[-*•]\s*|[0-9]+[.、)）]\s*)`)

func portraitCharacterCount(text string) int {
	return utf8.RuneCountInString(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, text))
}
func validateRichPortrait(raw []byte) error {
	var draft struct {
		Twin struct {
			Portrait struct {
				Version  string            `json:"prefill_version"`
				Fields   map[string]string `json:"fields"`
				Memories []struct {
					Content string `json:"content"`
				} `json:"memories"`
			} `json:"portrait"`
		} `json:"twin_profile"`
	}
	if json.Unmarshal(raw, &draft) != nil {
		return fmt.Errorf("画像草稿必须是 JSON")
	}
	p := draft.Twin.Portrait
	problems := []string{}
	if p.Version != richPortraitVersion {
		problems = append(problems, "缺少当前画像预填版本")
	}
	if portraitCharacterCount(p.Fields["bio"]) < 500 {
		problems = append(problems, "简介至少 500 字")
	}
	for _, rule := range []struct {
		key, label string
		minimum    int
	}{{"interests", "兴趣与长期关注", 10}, {"recent", "近期在做的事", 3}, {"connections", "想认识的人", 5}} {
		items := portraitItemBreak.Split(strings.TrimSpace(p.Fields[rule.key]), -1)
		valid := 0
		seen := map[string]bool{}
		for _, item := range items {
			item = strings.TrimSpace(portraitItemPrefix.ReplaceAllString(item, ""))
			if portraitCharacterCount(item) < 200 {
				continue
			}
			if seen[item] {
				continue
			}
			seen[item] = true
			valid++
		}
		if valid < rule.minimum {
			problems = append(problems, fmt.Sprintf("%s至少 %d 项，每项至少 200 字；目前合格 %d 项", rule.label, rule.minimum, valid))
		}
	}
	validMemories := 0
	seen := map[string]bool{}
	for _, m := range p.Memories {
		text := strings.TrimSpace(m.Content)
		if portraitCharacterCount(text) >= 300 && !seen[text] {
			validMemories++
			seen[text] = true
		}
	}
	if validMemories < 20 {
		problems = append(problems, fmt.Sprintf("事件记忆至少 20 条，每条至少 300 字；目前合格 %d 条", validMemories))
	}
	for _, key := range []string{"bio", "interests", "recent", "connections"} {
		for _, placeholder := range []string{"具体兴趣方向由你", "具体方向由你", "由你在注册页面", "待补充", "待填写", "这里没有提供", "材料没有提供", "所以不能补造", "这里不知道"} {
			if strings.Contains(p.Fields[key], placeholder) {
				problems = append(problems, key+" 中含检索或填写说明")
				break
			}
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("画像预填未完成：\n- %s", strings.Join(problems, "\n- "))
	}
	return nil
}
func init() {
	agentV2ProvisionCmd.Flags().Bool("require-rich-profile", false, "require a complete rich portrait before any registration writes")
	cmd := &cobra.Command{Use: "validate-profile --draft-file <path>", Short: "Check complete owner-grounded portrait before provisioning", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		path, _ := cmd.Flags().GetString("draft-file")
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err = validateRichPortrait(raw); err != nil {
			return err
		}
		output.PrintData(map[string]any{"valid": true, "prefill_version": richPortraitVersion}, resolveFormat())
		return nil
	}}
	cmd.Flags().String("draft-file", "", "private UTF-8 onboarding draft file")
	_ = cmd.MarkFlagRequired("draft-file")
	rootCmd.AddCommand(cmd)
}
