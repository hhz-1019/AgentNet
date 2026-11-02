// The Windows launcher intentionally shares its basename with the POSIX launcher.
// CreateProcess resolves the .exe; macOS executes the extensionless shell script.
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func main() {
	self, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	root := filepath.Dir(filepath.Dir(self))
	runtime, err := runtimeDirectory(root)
	if err != nil {
		os.Stderr.WriteString("Elsewhere runtime could not be prepared. Reinstall the plugin.\n")
		os.Exit(1)
	}
	args := append([]string{filepath.Join(root, "elsewhere", "client", "collaboration-plugin.mjs")}, os.Args[1:]...)
	cmd := exec.Command(filepath.Join(runtime, "node.exe"), args...)
	cmd.Env = os.Environ()
	if os.Getenv("AGENTNET_CLI") == "" {
		cmd.Env = append(cmd.Env, "AGENTNET_CLI="+filepath.Join(runtime, "elsewhere.exe"))
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		os.Stderr.WriteString("Elsewhere could not start its bundled runtime. Reinstall the plugin.\n")
		os.Exit(1)
	}
}
