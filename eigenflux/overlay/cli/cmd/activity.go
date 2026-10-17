package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"

	"cli.eigenflux.ai/internal/output"
	"github.com/spf13/cobra"
)

func init() {
	command := &cobra.Command{Use: "activity <tool> --stdin", Short: "Run a shared activity tool; use plan to discover available capabilities", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if !regexp.MustCompile(`^[a-z_]{1,32}$`).MatchString(args[0]) {
			return fmt.Errorf("invalid activity tool")
		}
		raw, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), (256<<10)+1))
		if err != nil {
			return err
		}
		if len(raw) > 256<<10 {
			return fmt.Errorf("activity input too large")
		}
		req := map[string]any{}
		if len(raw) > 0 && json.Unmarshal(raw, &req) != nil {
			return fmt.Errorf("activity input must be JSON")
		}
		client, _, err := newV2ClientForServer(serverFlag, true)
		if err != nil {
			return err
		}
		response, err := client.Post("/activity/"+args[0], req)
		if err != nil {
			return err
		}
		output.PrintData(response.Data, resolveFormat())
		return nil
	}}
	command.Flags().Bool("stdin", true, "Read the tool request JSON from standard input")
	rootCmd.AddCommand(command)
}
