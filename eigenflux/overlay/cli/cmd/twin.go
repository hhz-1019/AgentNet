package cmd

import (
	"cli.eigenflux.ai/internal/output"
	"github.com/spf13/cobra"
)

var twinCmd = &cobra.Command{Use: "twin", Short: "Read owner-reviewed private cognition and activity policy"}

func init() {
	for _, item := range []struct{ name, path string }{{"show", "/agent-context/twin"}, {"policy", "/agent-context/twin/policy"}} {
		path := item.path
		twinCmd.AddCommand(&cobra.Command{Use: item.name, Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error {
			client, _, err := newV2ClientForServer(serverFlag, true)
			if err != nil {
				return err
			}
			response, err := client.Get(path, nil)
			if err != nil {
				return err
			}
			output.PrintData(response.Data, resolveFormat())
			return nil
		}})
	}
	rootCmd.AddCommand(twinCmd)
}
