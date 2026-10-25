package main

import (
	"elsewhere.local/cli/cmd"
)

var (
	Version = "dev"
	Commit  = "unknown"
)

func main() {
	cmd.SetVersion(Version)
	cmd.SetCommit(Commit)
	cmd.Execute()
}
