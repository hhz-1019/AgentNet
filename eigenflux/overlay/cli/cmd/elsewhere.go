package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
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
		{"post", "/social/posts/", "GET", false},
		{"comments", "/social/posts/", "GET", false},
		{"comment", "/social/posts/", "POST", false},
		{"react", "/social/posts/", "PUT", false},
		{"person", "/social/people/", "GET", false},
		{"follow", "/social/people/", "PUT", false},
		{"avatar", "/agents/me/onboarding-avatar", "POST", false},
		{"portrait", "/agent-context/portrait", "GET", false},
		{"companion", "/agent-context/companion", "GET", false},
		{"name", "/agent-context/companion/name", "PUT", false},
		{"sync-portrait", "/agent-context/portrait", "PUT", false},
		{"groups", "/communication/groups", "GET", false},
		{"create-group", "/communication/groups", "POST", false},
		{"messages", "/communication/groups/", "GET", true},
		{"send", "/communication/groups/", "POST", true},
	} {
		spec := spec
		cmd := &cobra.Command{Use: spec.name, Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
			path := spec.path
			if spec.name == "post" || spec.name == "comments" || spec.name == "comment" || spec.name == "react" || spec.name == "person" || spec.name == "follow" {
				id, _ := cmd.Flags().GetString("id")
				if !regexp.MustCompile("^[1-9][0-9]*$").MatchString(id) {
					return fmt.Errorf("valid --id required")
				}
				path += id
				switch spec.name {
				case "comments", "comment":
					path += "/comments"
				case "react":
					path += "/reaction"
				case "follow":
					path += "/follow"
				}
			}
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
			if spec.name == "avatar" {
				imagePath, _ := cmd.Flags().GetString("image")
				if imagePath != "" {
					if !filepath.IsAbs(imagePath) {
						return fmt.Errorf("--image must be an absolute authorized path")
					}
					file, err := os.Open(imagePath)
					if err != nil {
						return err
					}
					defer file.Close()
					data, err := io.ReadAll(io.LimitReader(file, (8<<20)+1))
					if err != nil {
						return err
					}
					if len(data) > 8<<20 {
						return fmt.Errorf("avatar image must not exceed 8 MB")
					}
					resp, err := client.Post(path, map[string]any{"data": base64.StdEncoding.EncodeToString(data)})
					if err != nil {
						return err
					}
					output.PrintData(resp.Data, resolveFormat())
					return nil
				}
			}
			maxJSON := int64(2 << 20)
			if spec.name == "avatar" {
				maxJSON = 12 << 20
			}
			raw, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), maxJSON+1))
			if err != nil {
				return err
			}
			var req map[string]any
			if int64(len(raw)) > maxJSON || json.Unmarshal(raw, &req) != nil {
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
		cmd.Flags().String("id", "", "post or Agent ID")
		cmd.Flags().String("group", "", "group ID")
		if spec.name == "avatar" {
			cmd.Flags().String("image", "", "absolute path to a public PNG/JPEG avatar")
		}
		root.AddCommand(cmd)
	}
	rootCmd.AddCommand(root)
}
