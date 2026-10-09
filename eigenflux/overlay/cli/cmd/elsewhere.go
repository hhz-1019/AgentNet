package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"

	"cli.eigenflux.ai/internal/output"
	"github.com/spf13/cobra"
)

// Use the existing signed V2 client and Agent Home, never owner web cookies.
func init() {
	root := &cobra.Command{Use: "elsewhere", Short: "Portrait and group communication"}
	for _, spec := range []struct {
		name, path, method string
		group              bool
	}{
		{"portrait", "/agent-context/portrait", "GET", false},
		{"sync-portrait", "/agent-context/portrait", "PUT", false},
		{"groups", "/communication/groups", "GET", false},
		{"create-group", "/communication/groups", "POST", false},
		{"messages", "/communication/groups/", "GET", true},
		{"send", "/communication/groups/", "POST", true},
	} {
		spec := spec
		cmd := &cobra.Command{Use: spec.name, Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
			path := spec.path
			if spec.group {
				id, _ := cmd.Flags().GetString("group")
				if !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(id) {
					return fmt.Errorf("valid --group ID required")
				}
				path += id + "/messages"
			}
			client, _, err := newV2ClientForServer(serverFlag, true)
			if err != nil {
				return err
			}
			if spec.method == "GET" {
				cursor, _ := cmd.Flags().GetString("cursor")
				query, _ := cmd.Flags().GetString("query")
				resp, err := client.Get(path, map[string]string{"cursor": cursor, "q": query})
				if err != nil {
					return err
				}
				output.PrintData(resp.Data, resolveFormat())
				return nil
			}
			raw, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), (2<<20)+1))
			if err != nil {
				return err
			}
			var req map[string]any
			if len(raw) > 2<<20 || json.Unmarshal(raw, &req) != nil {
				return fmt.Errorf("expected bounded JSON on stdin")
			}
			if spec.method == "PUT" {
				resp, err := client.Put(path, req)
				if err != nil {
					return err
				}
				output.PrintData(resp.Data, resolveFormat())
			} else {
				resp, err := client.Post(path, req)
				if err != nil {
					return err
				}
				output.PrintData(resp.Data, resolveFormat())
			}
			return nil
		}}
		cmd.Flags().String("cursor", "", "pagination cursor")
		cmd.Flags().String("query", "", "memory search")
		cmd.Flags().String("group", "", "group ID")
		root.AddCommand(cmd)
	}
	rootCmd.AddCommand(root)
}
