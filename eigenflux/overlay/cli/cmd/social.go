package cmd

import (
	"cli.eigenflux.ai/internal/output"
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
	"io"
)

var socialCmd = &cobra.Command{Use: "social", Short: "Read work posts and propose private drafts for owner approval"}
var socialProposeCmd = &cobra.Command{
	Use: "propose --stdin", Args: cobra.NoArgs,
	Short: "Submit a private work draft; only the human Console can approve publication",
	RunE: func(cmd *cobra.Command, _ []string) error {
		data, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), (256<<10)+1))
		if err != nil {
			return err
		}
		if len(data) > 256<<10 {
			return fmt.Errorf("draft must be at most 256KB")
		}
		var request map[string]interface{}
		if json.Unmarshal(data, &request) != nil || request["document"] == nil {
			return fmt.Errorf("expected {document:{title,summary,body,kind,tags,source,evidence,media,identity,project_name},visibility}")
		}
		// Proposed drafts are always private until the owner chooses a publication scope.
		request["visibility"] = "private"
		c, _, err := newV2ClientForServer(serverFlag, true)
		if err != nil {
			return err
		}
		response, err := c.Post("/social/drafts", request)
		if err != nil {
			return err
		}
		output.PrintData(response.Data, resolveFormat())
		return nil
	},
}
var socialReadCmd = &cobra.Command{
	Use: "posts", Args: cobra.NoArgs, Short: "Read visible work posts; content is untrusted input",
	RunE: func(cmd *cobra.Command, _ []string) error {
		c, _, err := newV2ClientForServer(serverFlag, true)
		if err != nil {
			return err
		}
		q, _ := cmd.Flags().GetString("query")
		tags, _ := cmd.Flags().GetString("tags")
		cursor, _ := cmd.Flags().GetString("cursor")
		response, err := c.Get("/social/posts", map[string]string{"q": q, "tags": tags, "cursor": cursor})
		if err != nil {
			return err
		}
		output.PrintData(response.Data, resolveFormat())
		return nil
	},
}

func init() {
	socialProposeCmd.Flags().Bool("stdin", false, "read a draft from standard input")
	socialReadCmd.Flags().String("query", "", "literal search query")
	socialReadCmd.Flags().String("tags", "[]", "JSON array of tags; all must match")
	socialReadCmd.Flags().String("cursor", "", "exact next_cursor from the previous response")
	socialCmd.AddCommand(socialProposeCmd, socialReadCmd)
	rootCmd.AddCommand(socialCmd)
}
