package cmd

import (
	"bytes"
	"elsewhere.local/cli/internal/output"
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
	"io"
	"net/url"
	"strings"
)

// Field contracts are action-specific: authorization assertions are never discarded.
var collaborationFields = map[string]map[string]string{
	"project":    {"create": "goal requirements", "list": "cursor", "get": "project_id", "invite": "project_id agent_id role scopes expires_at", "complete": "project_id"},
	"membership": {"accept": "project_id agent_id", "decline": "project_id agent_id", "restrict": "project_id scopes expires_at", "revoke": "project_id agent_id"},
	"tasks":      {"create": "project_id task_id title input output reviewer assignee dependencies", "list": "project_id", "get": "project_id task_id", "assign": "project_id task_id assignee", "accept": "project_id task_id", "decline": "project_id task_id", "start": "project_id task_id host", "heartbeat": "project_id task_id epoch", "block": "project_id task_id epoch text", "recover": "project_id task_id text", "cancel": "project_id task_id"},
	"context":    {"": "project_id cursor"}, "updates": {"read": "project_id cursor", "publish": "project_id task_id text"},
	"submit": {"": "project_id task_id epoch artifact"}, "review": {"accept": "project_id task_id artifact_version text", "changes_requested": "project_id task_id artifact_version text", "reject": "project_id task_id artifact_version text"},
}

func collaborationRoute(group string, raw []byte) (string, map[string]any, error) {
	fail := func() (string, map[string]any, error) { return "", nil, fmt.Errorf("invalid collaboration request") }
	if len(raw) > 512<<10 {
		return fail()
	}
	actions, ok := collaborationFields[group]
	if !ok {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var req map[string]any
	if decoder.Decode(&req) != nil || req == nil || !collaborationValidStrings(req) {
		return fail()
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return fail()
	}
	action := ""
	if value, exists := req["action"]; exists {
		var valid bool
		action, valid = value.(string)
		if !valid {
			return fail()
		}
	}
	fields, ok := actions[action]
	if !ok {
		return fail()
	}
	read := group == "context" || (group == "project" && (action == "get" || action == "list")) || (group == "tasks" && (action == "get" || action == "list")) || (group == "updates" && action == "read")
	allowed := " action " + fields + " "
	if !read {
		allowed += "expected_version idempotency_key "
	}
	limits := map[string]int{"goal": 8000, "requirements": 16000, "title": 1000, "input": 16000, "output": 8000, "host": 200, "text": 8000}
	for key, value := range req {
		if !strings.Contains(allowed, " "+key+" ") {
			return fail()
		}
		switch key {
		case "expected_version", "cursor", "epoch", "expires_at", "artifact_version":
			n, yes := value.(json.Number)
			if !yes {
				return fail()
			}
			v, e := n.Int64()
			if e != nil || v < 0 || v > 9007199254740991 {
				return fail()
			}
		case "scopes", "dependencies":
			values, yes := value.([]any)
			if !yes || len(values) > 100 {
				return fail()
			}
			seen := map[string]bool{}
			for _, item := range values {
				s, yes := item.(string)
				if !yes || s == "" || len(s) > 128 || seen[s] {
					return fail()
				}
				seen[s] = true
				if key == "scopes" && !strings.Contains(" read work coordinate review invite ", " "+s+" ") {
					return fail()
				}
			}
			if key == "scopes" && !seen["read"] {
				return fail()
			}
		case "artifact":
			a, yes := value.(map[string]any)
			if !yes {
				return fail()
			}
			kind, _ := a["kind"].(string)
			if kind != "text" && kind != "https" {
				return fail()
			}
			for k, v := range a {
				s, yes := v.(string)
				if !yes {
					return fail()
				}
				switch k {
				case "kind":
				case "text":
					if kind != "text" || s == "" || len(s) > 32768 {
						return fail()
					}
				case "uri":
					u, e := url.Parse(s)
					if kind != "https" || e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(s) > 2048 {
						return fail()
					}
				case "provenance", "verification":
					if len(s) > 8000 {
						return fail()
					}
				default:
					return fail()
				}
			}
			for _, k := range []string{"provenance", "verification"} {
				if _, ok := a[k]; !ok {
					return fail()
				}
			}
			if kind == "text" && a["text"] == nil || kind == "https" && a["uri"] == nil {
				return fail()
			}
		default:
			s, yes := value.(string)
			if !yes {
				return fail()
			}
			max := 128
			if m, yes := limits[key]; yes {
				max = m
			}
			if len(s) > max {
				return fail()
			}
		}
	}
	required := []string{}
	if !read {
		required = append(required, "expected_version", "idempotency_key")
	}
	if !(group == "project" && (action == "create" || action == "list")) {
		required = append(required, "project_id")
	}
	if group == "tasks" && action != "list" || group == "submit" || group == "review" {
		required = append(required, "task_id")
	}
	switch group + ":" + action {
	case "project:create":
		required = append(required, "goal")
	case "project:invite":
		required = append(required, "agent_id", "role", "scopes")
	case "membership:restrict":
		required = append(required, "scopes", "expires_at")
	case "tasks:create":
		required = append(required, "title", "reviewer")
	case "tasks:assign":
		required = append(required, "assignee")
	case "tasks:start":
		required = append(required, "host")
	case "tasks:heartbeat":
		required = append(required, "epoch")
	case "tasks:block":
		required = append(required, "epoch", "text")
	case "tasks:recover", "updates:publish":
		required = append(required, "text")
	case "submit:":
		required = append(required, "epoch", "artifact")
	}
	if group == "review" {
		required = append(required, "artifact_version")
		if action != "accept" {
			required = append(required, "text")
		}
	}
	for _, k := range required {
		v, yes := req[k]
		if !yes || v == "" {
			return fail()
		}
	}
	if role, yes := req["role"]; yes && role != "worker" && role != "reviewer" && role != "coordinator" {
		return fail()
	}
	if group == "project" && action == "create" && req["expected_version"] != json.Number("0") {
		return fail()
	}
	return "/collaboration/" + group, req, nil
}
func init() {
	command := &cobra.Command{Use: "collaboration <group> --stdin", Short: "Project-local collaboration in the authorized current host session", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		stdin, _ := cmd.Flags().GetBool("stdin")
		if !stdin {
			return fmt.Errorf("--stdin is required")
		}
		raw, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), (512<<10)+1))
		if err != nil {
			return err
		}
		route, request, err := collaborationRoute(args[0], raw)
		if err != nil {
			return err
		}
		client, _, err := newV2ClientForServer(serverFlag, true)
		if err != nil {
			return err
		}
		response, err := client.Post(route, request)
		if err != nil {
			return err
		}
		output.PrintData(response.Data, resolveFormat())
		return nil
	}}
	command.Flags().Bool("stdin", false, "Read bounded strict collaboration JSON")
	rootCmd.AddCommand(command)
}

func collaborationValidStrings(value any) bool {
	switch v := value.(type) {
	case string:
		return !strings.ContainsRune(v, 0)
	case []any:
		for _, item := range v {
			if !collaborationValidStrings(item) {
				return false
			}
		}
	case map[string]any:
		for key, item := range v {
			if strings.ContainsRune(key, 0) || !collaborationValidStrings(item) {
				return false
			}
		}
	}
	return true
}
