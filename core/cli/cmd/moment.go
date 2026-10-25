package cmd

import (
	"elsewhere.local/cli/internal/output"
	"fmt"
	"github.com/spf13/cobra"
	"strconv"
	"unicode/utf8"
)

type momentContext struct {
	RelatedAgentID string            `json:"related_agent_id,omitempty"`
	Priority       int               `json:"priority"`
	ExecutorID     string            `json:"executor_id"`
	Scopes         map[string]string `json:"scopes"`
}

type momentExecution struct {
	HostID    string `json:"host_id"`
	SessionID string `json:"session_id"`
	InputHash string `json:"input_hash"`
	Evidence  string `json:"evidence"`
}

func validMomentExecution(e *momentExecution) bool {
	return e == nil || (len(e.HostID) > 0 && len(e.HostID) <= 128 && len(e.SessionID) > 0 && len(e.SessionID) <= 128 && len(e.InputHash) == 64 && utf8.RuneCountInString(e.Evidence) > 0 && utf8.RuneCountInString(e.Evidence) <= 2000)
}

var momentRenewCmd = &cobra.Command{
	Use: "renew", Short: "Renew a claimed Attention command without executing it again",
	RunE: func(cmd *cobra.Command, _ []string) error {
		id, _ := cmd.Flags().GetString("command-id")
		token, _ := cmd.Flags().GetString("claim-token")
		epoch, _ := cmd.Flags().GetInt64("claim-epoch")
		executor, _ := cmd.Flags().GetString("executor-id")
		if n, e := strconv.ParseInt(id, 10, 64); e != nil || n <= 0 || token == "" || epoch <= 0 {
			return fmt.Errorf("command and claim proof required")
		}
		client, server, e := newV2ClientForServer(serverFlag, true)
		if e != nil {
			return e
		}
		runtime, e := runtimeInstanceID(server.Name)
		if e != nil {
			return e
		}
		response, e := client.Post("/agent-commands/"+id+"/renew", map[string]interface{}{"runtime_instance_id": runtime, "claim_token": token, "claim_epoch": epoch, "executor_id": executor})
		if e != nil {
			return e
		}
		output.PrintData(response.Data, resolveFormat())
		return nil
	},
}

func init() {
	momentRenewCmd.Flags().String("command-id", "", "Command ID")
	momentRenewCmd.Flags().String("claim-token", "", "Claim token")
	momentRenewCmd.Flags().Int64("claim-epoch", 0, "Claim epoch")
	momentRenewCmd.Flags().String("executor-id", "", "Bound executor")
	runtimeV2CommandCmd.AddCommand(momentRenewCmd)
}
