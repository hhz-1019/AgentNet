package auth

import (
	"elsewhere.local/cli/internal/config"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestV2CredentialsLockProcessHelper(t *testing.T) {
	if os.Getenv("V2_LOCK_HELPER") != "1" {
		t.Skip("subprocess fixture")
	}
	err := WithV2CredentialsLock("review", 4*time.Second, func() error {
		dir := filepath.Join(config.HomeDir(), "servers", "review")
		critical := filepath.Join(dir, "exclusive-callback")
		f, e := os.OpenFile(critical, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return fmt.Errorf("overlapping credential callback: %w", e)
		}
		_ = f.Close()
		if signal := os.Getenv("V2_LOCK_READY"); signal != "" {
			if e = os.WriteFile(signal, []byte("ready"), 0600); e != nil {
				return e
			}
		}
		if gate := os.Getenv("V2_LOCK_GATE"); gate != "" {
			for {
				if _, e = os.Stat(gate); e == nil {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		} else {
			time.Sleep(40 * time.Millisecond)
		}
		return os.Remove(critical)
	})
	if err != nil {
		t.Fatal(err)
	}
}
func v2LockChild(t *testing.T, ready, gate string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestV2CredentialsLockProcessHelper$", "-test.timeout=10s")
	cmd.Env = append(os.Environ(), "V2_LOCK_HELPER=1", "V2_LOCK_READY="+ready, "V2_LOCK_GATE="+gate)
	return cmd
}
func waitV2LockSignal(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if _, e := os.Stat(path); e == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("child did not acquire credential lock")
}
func v2LockPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(config.HomeDir(), "servers", "review", ".agent-v2-refresh.lock")
}
func TestV2CredentialsLockMultiProcess(t *testing.T) {
	t.Setenv("ELSEWHERE_HOME", t.TempDir())
	for wave := 0; wave < 3; wave++ {
		commands := []*exec.Cmd{}
		for i := 0; i < 6; i++ {
			cmd := v2LockChild(t, "", "")
			if e := cmd.Start(); e != nil {
				t.Fatal(e)
			}
			commands = append(commands, cmd)
		}
		for _, cmd := range commands {
			if e := cmd.Wait(); e != nil {
				t.Fatal("multiprocess credential exclusion/release", e)
			}
		}
	}
	// Repeated ownership uses the same persistent file, never delete/recreate.
	before, e := os.Stat(v2LockPath(t))
	if e != nil {
		t.Fatal(e)
	}
	if e = WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal(e)
	}
	after, e := os.Stat(v2LockPath(t))
	if e != nil || !os.SameFile(before, after) {
		t.Fatal("lock anchor replaced", e)
	}
}
func TestV2CredentialsLockRecoversDeadProcess(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ELSEWHERE_HOME", home)
	ready := filepath.Join(home, "ready")
	gate := filepath.Join(home, "never-release")
	child := v2LockChild(t, ready, gate)
	if e := child.Start(); e != nil {
		t.Fatal(e)
	}
	defer child.Process.Kill()
	waitV2LockSignal(t, ready)
	// A live owner is never stolen, even if its metadata looks arbitrarily old.
	if e := WithV2CredentialsLock("review", 80*time.Millisecond, func() error { t.Fatal("live owner stolen"); return nil }); e == nil || !strings.Contains(e.Error(), "timed out") {
		t.Fatal(e)
	}
	if e := child.Process.Kill(); e != nil {
		t.Fatal(e)
	}
	_ = child.Wait()
	// The killed fixture's callback marker is not a credential and is test-only.
	if e := os.Remove(filepath.Join(filepath.Dir(v2LockPath(t)), "exclusive-callback")); e != nil {
		t.Fatal(e)
	}
	if e := WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal("kernel did not release dead owner's lock", e)
	}
}
func TestV2CredentialsLockLegacyOwnerAndDeadline(t *testing.T) {
	t.Setenv("ELSEWHERE_HOME", t.TempDir())
	path := v2LockPath(t)
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		t.Fatal(e)
	}
	for _, metadata := range []string{fmt.Sprintf("%d 1\n", os.Getpid()), "malformed\n", ""} {
		if e := os.WriteFile(path, []byte(metadata), 0600); e != nil {
			t.Fatal(e)
		}
		start := time.Now()
		if e := WithV2CredentialsLock("review", 60*time.Millisecond, func() error { t.Fatal("live/unknown legacy owner stolen"); return nil }); e == nil {
			t.Fatal("expected timeout")
		}
		if time.Since(start) > 500*time.Millisecond {
			t.Fatal("lock deadline was extended")
		}
	}
	// Derive a genuinely exited PID rather than assuming an arbitrary number dead.
	child := exec.Command(os.Args[0], "-test.run=^$")
	if e := child.Run(); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path, []byte(fmt.Sprintf("%d %d\n", child.ProcessState.Pid(), time.Now().Unix())), 0600); e != nil {
		t.Fatal(e)
	}
	if e := WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal("dead legacy owner not adopted", e)
	}
	if e := WithV2CredentialsLock("review", -time.Second, func() error { t.Fatal("expired deadline entered"); return nil }); e == nil {
		t.Fatal("negative deadline accepted")
	}
}
func TestV2CredentialsLockWindowsSharingReader(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows delete-sharing regression")
	}
	home := t.TempDir()
	t.Setenv("ELSEWHERE_HOME", home)
	ready := filepath.Join(home, "ready")
	gate := filepath.Join(home, "release")
	child := v2LockChild(t, ready, gate)
	if e := child.Start(); e != nil {
		t.Fatal(e)
	}
	defer child.Process.Kill()
	waitV2LockSignal(t, ready)
	reader, e := os.Open(v2LockPath(t))
	if e != nil {
		t.Fatal(e)
	}
	defer reader.Close()
	if e = os.Remove(v2LockPath(t)); e == nil {
		t.Fatal("fixture did not establish Windows sharing-delete denial")
	}
	if e = os.WriteFile(gate, []byte("release"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = child.Wait(); e != nil {
		t.Fatal("owner failed release while reader remained open", e)
	}
	if e = WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal("reader prevented successor's kernel acquisition", e)
	}
}

func TestV2CredentialsLockCallbackFailureReleases(t *testing.T) {
	t.Setenv("ELSEWHERE_HOME", t.TempDir())
	cause := fmt.Errorf("fixture callback failure")
	if e := WithV2CredentialsLock("review", time.Second, func() error { return cause }); e != cause {
		t.Fatal("callback error hidden", e)
	}
	if e := WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal("callback failure retained lock", e)
	}
	data, e := os.ReadFile(v2LockPath(t))
	if e != nil {
		t.Fatal(e)
	}
	fields := strings.Fields(string(data))
	if len(fields) != 2 || fields[1] != v2CredentialLockProtocol {
		t.Fatal("legacy-compatible kernel marker missing")
	}
	created, e := strconv.ParseInt(fields[1], 10, 64)
	if e != nil {
		t.Fatal(e)
	}
	if time.Now().Unix()-created > 120 {
		t.Fatal("old stale predicate would delete new-protocol anchor")
	}
}

func TestV2CredentialsLockRejectsUnsafeAnchors(t *testing.T) {
	t.Run("directory", func(t *testing.T) {
		t.Setenv("ELSEWHERE_HOME", t.TempDir())
		path := v2LockPath(t)
		if e := os.MkdirAll(path, 0700); e != nil {
			t.Fatal(e)
		}
		if e := WithV2CredentialsLock("review", time.Second, func() error { t.Fatal("directory accepted"); return nil }); e == nil {
			t.Fatal("nonregular anchor accepted")
		}
	})
	t.Run("symlink", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("ELSEWHERE_HOME", home)
		path := v2LockPath(t)
		if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			t.Fatal(e)
		}
		target := filepath.Join(home, "target")
		original := []byte(fmt.Sprintf("%d %s\n", os.Getpid(), v2CredentialLockProtocol))
		if e := os.WriteFile(target, original, 0600); e != nil {
			t.Fatal(e)
		}
		if e := os.Symlink(target, path); e != nil {
			t.Skip("symlink privilege unavailable")
		}
		if e := WithV2CredentialsLock("review", time.Second, func() error { t.Fatal("symlink accepted"); return nil }); e == nil {
			t.Fatal("symlink anchor accepted")
		}
		after, e := os.ReadFile(target)
		if e != nil || string(after) != string(original) {
			t.Fatal("symlink target modified", e)
		}
	})
}

func TestV2CredentialsLockInitializedAnchorIsImmutable(t *testing.T) {
	t.Setenv("ELSEWHERE_HOME", t.TempDir())
	path := v2LockPath(t)
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		t.Fatal(e)
	}
	original := []byte(fmt.Sprintf("%d %s\n", os.Getpid(), v2CredentialLockProtocol))
	if e := os.WriteFile(path, original, 0600); e != nil {
		t.Fatal(e)
	}
	old := time.Unix(946684800, 0)
	if e := os.Chtimes(path, old, old); e != nil {
		t.Fatal(e)
	}
	before, e := os.Stat(path)
	if e != nil {
		t.Fatal(e)
	}
	check := func() {
		t.Helper()
		after, e := os.Stat(path)
		if e != nil {
			t.Fatal(e)
		}
		bytes, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || string(bytes) != string(original) {
			t.Fatal("validated anchor was rewritten or replaced")
		}
	}
	if e = WithV2CredentialsLock("review", time.Second, func() error { return nil }); e != nil {
		t.Fatal(e)
	}
	check()
	cause := fmt.Errorf("fixture callback failure")
	if e = WithV2CredentialsLock("review", time.Second, func() error { return cause }); e != cause {
		t.Fatal("callback failure hidden", e)
	}
	check()
	child := v2LockChild(t, "", "")
	if e = child.Run(); e != nil {
		t.Fatal("successor process failed", e)
	}
	check()
}
