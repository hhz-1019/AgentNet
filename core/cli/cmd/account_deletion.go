package cmd

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"elsewhere.local/cli/internal/auth"
	"elsewhere.local/cli/internal/cache"
	"elsewhere.local/cli/internal/client"
	"elsewhere.local/cli/internal/config"
	"elsewhere.local/cli/internal/output"
	"elsewhere.local/cli/internal/profilestate"
	"github.com/spf13/cobra"
)

type deletedConnection struct {
	Status          string `json:"status"`
	Endpoint        string `json:"endpoint"`
	AgentID         string `json:"agent_id,omitempty"` // Only until cleanup completes.
	LocalCleanup    string `json:"local_cleanup"`
	SchedulerAction string `json:"scheduler_action"`
}

func deletionMarkerPath(server string) string {
	return filepath.Join(cache.ServerDir(server), "account-deleted.json")
}

// Only the known connection-owned paths are removed. Never remove a Home, a
// server directory, shared Skills, host memory, or scheduler/project files.
func safeConnectionDirectory(server string) error {
	if server == "" || server == "." || server == ".." || strings.ContainsAny(server, "/\\") {
		return fmt.Errorf("invalid server scope")
	}
	for _, path := range []string{filepath.Join(config.HomeDir(), "servers"), cache.ServerDir(server)} {
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("connection directory must not be a symlink")
		}
	}
	return nil
}

func saveDeletionMarker(server string, state deletedConnection) error {
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(cache.ServerDir(server), ".deleted-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(raw)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), deletionMarkerPath(server))
}

func finishConnectionDeletion(server string, state deletedConnection) error {
	if err := safeConnectionDirectory(server); err != nil {
		return err
	}
	remove := func(path string) error {
		err := os.Remove(path)
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	// The pending marker is durable before the first removal. Any interrupted
	// cleanup resumes without keys, tokens, or another network request.
	for _, name := range []string{"agent-v2-credentials.json", "credentials.json", "identity.json", "install-ref.json", "profile.json", "contacts.json", "control-context.json", "capabilities-zh-CN.json", "capabilities-en.json"} {
		if err := remove(filepath.Join(cache.ServerDir(server), name)); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(cache.ServerDataDir(server)); err != nil {
		return err
	}
	if state.AgentID != "" {
		if err := profilestate.Delete(config.HomeDir(), server, state.AgentID); err != nil {
			return err
		}
	}
	if err := remove(filepath.Join(config.HomeDir(), "runtime-"+profilestate.ScopeID(server, "")+".json")); err != nil {
		return err
	}
	state.AgentID, state.LocalCleanup = "", "completed"
	return saveDeletionMarker(server, state)
}

func deletedAccountError() error {
	return &client.APIError{StatusCode: 410, ErrorCode: "ACCOUNT_DELETED", Msg: "账户已注销；本地连接已清理。停止此账号的巡查任务，不要自动注册；保留宿主记忆和其他项目文件。"}
}

func isDeletedAccountError(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) && apiErr.ErrorCode == "ACCOUNT_DELETED"
}

func guardDeletedConnection() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	server, err := cfg.GetActive(serverFlag)
	if err != nil {
		return err
	}
	return guardDeletedServer(server.Name)
}

func guardDeletedServer(server string) error {
	return auth.WithV2CredentialsLock(server, 35*time.Second, func() error {
		return resumeConnectionDeletion(server)
	})
}

func resumeConnectionDeletion(server string) error {
	raw, err := os.ReadFile(deletionMarkerPath(server))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state deletedConnection
	if json.Unmarshal(raw, &state) != nil || state.Status != "deleted" || (state.LocalCleanup != "pending" && state.LocalCleanup != "completed") {
		return fmt.Errorf("invalid local account deletion state; stop and preserve local files")
	}
	if state.LocalCleanup == "pending" {
		if err := finishConnectionDeletion(server, state); err != nil {
			return fmt.Errorf("ACCOUNT_DELETION_CLEANUP_REQUIRED: %w", err)
		}
	}
	return deletedAccountError()
}

func confirmConnectionDeletion(server, endpoint string) (bool, error) {
	credentials, err := auth.LoadV2Credentials(server)
	if err != nil {
		return false, err
	}
	publicKey, privateKey, err := auth.LoadExistingIdentity(server)
	if err != nil {
		return false, err
	}
	origin, err := url.Parse(endpoint)
	if err != nil || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" ||
		(origin.Path != "" && origin.Path != "/") ||
		(origin.Scheme != "https" && !(origin.Scheme == "http" && (origin.Hostname() == "localhost" || origin.Hostname() == "127.0.0.1" || origin.Hostname() == "::1"))) {
		return false, fmt.Errorf("use a trusted HTTPS origin for account status")
	}
	nonce, err := newBrowserNonce()
	if err != nil {
		return false, err
	}
	issuedAt := time.Now().UnixMilli()
	transcript := fmt.Sprintf("ELSEWHERE-ACCOUNT-DELETION-V1\n%s\n%d\n%s", credentials.AgentID, issuedAt, nonce)
	request := map[string]any{"agent_id": credentials.AgentID, "public_key": base64.RawURLEncoding.EncodeToString(publicKey),
		"issued_at": issuedAt, "nonce": nonce, "signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(transcript)))}
	c := client.New(strings.TrimRight(endpoint, "/")+"/api/v2", "", version, clientMetaForServerName(server))
	c.HTTPClient.Timeout = 10 * time.Second
	response, err := c.Post("/agent-account-deletion/status", request)
	if err != nil {
		return false, err
	}
	var result struct {
		Status    string `json:"status"`
		AgentID   string `json:"agent_id"`
		Nonce     string `json:"nonce"`
		DeletedAt int64  `json:"deleted_at"`
	}
	if response.Code != 0 || json.Unmarshal(response.Data, &result) != nil || result.AgentID != credentials.AgentID || result.Nonce != nonce ||
		(result.Status != "deleted" && result.Status != "not_deleted") || (result.Status == "deleted" && result.DeletedAt <= 0) {
		return false, fmt.Errorf("invalid account deletion confirmation; preserve local connection")
	}
	if result.Status != "deleted" {
		return false, nil
	}
	state := deletedConnection{Status: "deleted", Endpoint: endpoint, AgentID: credentials.AgentID, LocalCleanup: "pending", SchedulerAction: "stop_account_patrol"}
	if err := safeConnectionDirectory(server); err != nil {
		return false, err
	}
	if err := saveDeletionMarker(server, state); err != nil {
		return false, err
	}
	if err := finishConnectionDeletion(server, state); err != nil {
		return false, fmt.Errorf("ACCOUNT_DELETION_CLEANUP_REQUIRED: %w", err)
	}
	return true, nil
}

// Called inside the existing per-server credential lock, on refresh failure.
// Never replace an ordinary authentication/network error with an erasure.
func deletionAfterAuthFailure(server, endpoint string, original error) error {
	deleted, err := confirmConnectionDeletion(server, endpoint)
	if err != nil {
		// A durable pending marker must be retried even if tokens are gone.
		if stateErr := resumeConnectionDeletion(server); stateErr != nil {
			return stateErr
		}
		return original
	}
	if deleted {
		return deletedAccountError()
	}
	return original
}

func printDeletedConnection(server string) error {
	raw, err := os.ReadFile(deletionMarkerPath(server))
	if err != nil {
		return err
	}
	output.PrintData(json.RawMessage(raw), resolveFormat())
	return nil
}

func init() {
	agentV2Cmd.AddCommand(&cobra.Command{Use: "account-status", Short: "Confirm account deletion and clean only this local connection", Args: cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			server, err := cfg.GetActive(serverFlag)
			if err != nil {
				return err
			}
			deleted := false
			err = auth.WithV2CredentialsLock(server.Name, 35*time.Second, func() error {
				if markerErr := resumeConnectionDeletion(server.Name); markerErr != nil {
					if isDeletedAccountError(markerErr) {
						deleted = true
						return nil
					}
					return markerErr
				}
				var checkErr error
				deleted, checkErr = confirmConnectionDeletion(server.Name, server.Endpoint)
				return checkErr
			})
			if err != nil {
				return err
			}
			if deleted {
				return printDeletedConnection(server.Name)
			}
			output.PrintData(json.RawMessage(`{"status":"not_deleted"}`), resolveFormat())
			return nil
		}})
}
