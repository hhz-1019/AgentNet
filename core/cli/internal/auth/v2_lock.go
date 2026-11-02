package auth

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"elsewhere.local/cli/internal/config"
)

var credentialProcessLocks sync.Map

// A legacy reader treats this future timestamp as permanently non-expiring.
// New readers use only the kernel lock; it is a protocol marker, not a lease.
const v2CredentialLockProtocol = "9223372036854775807"

// WithV2CredentialsLock serializes credential rotation and deletion across CLI
// processes. Reload credentials inside the callback. The persistent file is
// only a kernel-lock anchor, never an expiring lease and never unlinked here.
func WithV2CredentialsLock(serverName string, wait time.Duration, callback func() error) (result error) {
	deadline := time.Now().Add(wait)
	dir := filepath.Join(config.HomeDir(), "servers", serverName)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	path := filepath.Join(dir, ".agent-v2-refresh.lock")
	value, _ := credentialProcessLocks.LoadOrStore(path, make(chan struct{}, 1))
	local := value.(chan struct{})
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return v2CredentialLockTimeout()
	}
	timer := time.NewTimer(remaining)
	defer timer.Stop()
	select {
	case local <- struct{}{}:
		defer func() { <-local }()
	case <-timer.C:
		return v2CredentialLockTimeout()
	}
	for {
		if time.Until(deadline) <= 0 {
			return v2CredentialLockTimeout()
		}
		if info, err := os.Lstat(path); err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("Agent V2 credential refresh lock must be a regular file; keep agent-v2-credentials.json intact")
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		fresh := err == nil
		if os.IsExist(err) {
			file, err = os.OpenFile(path, os.O_RDWR, 0600)
		}
		if err != nil {
			return err
		}
		if same, err := currentV2CredentialAnchor(file, path); err != nil || !same {
			closeErr := file.Close()
			if err != nil || closeErr != nil {
				return errors.Join(err, closeErr)
			}
			if err = waitV2CredentialLock(deadline); err != nil {
				return err
			}
			continue
		}
		// Keep this descriptor (and fresh-file provenance) while contending.
		// Otherwise a contender can inspect a freshly created empty anchor first,
		// and its creator would forget it is safe to initialize on the next try.
		for {
			acquired, lockErr := tryV2CredentialFileLock(file)
			if lockErr != nil {
				return errors.Join(lockErr, file.Close())
			}
			if acquired {
				break
			}
			if err = waitV2CredentialLock(deadline); err != nil {
				return errors.Join(err, file.Close())
			}
		}
		// A pre-upgrade owner did not acquire a kernel lock. Never infer its death
		// from age: a slow live owner must keep exclusive access. Unknown liveness
		// also fails closed. New-format metadata is not an ownership assertion.
		// Check before reading metadata too: opening a replaced symlink must
		// never read or truncate its target (which could be a credentials file).
		same, identityErr := currentV2CredentialAnchor(file, path)
		if identityErr != nil {
			return errors.Join(identityErr, unlockV2CredentialFile(file), file.Close())
		}
		legacyActive := false
		initialized := false
		if same {
			legacyActive, initialized, err = legacyV2CredentialOwnerActive(file, fresh)
			if err != nil {
				return errors.Join(err, unlockV2CredentialFile(file), file.Close())
			}
		}
		if legacyActive || !same {
			releaseErr := errors.Join(unlockV2CredentialFile(file), file.Close())
			if releaseErr != nil {
				return fmt.Errorf("cannot release Agent V2 credential refresh lock: %w", releaseErr)
			}
			if err = waitV2CredentialLock(deadline); err != nil {
				return err
			}
			continue
		}
		// File identity stays stable for cooperating processes: no stale remover,
		// expiry takeover, or PID-based unlink can detach a newer owner's lock.
		defer func() {
			if err := errors.Join(unlockV2CredentialFile(file), file.Close()); err != nil {
				result = errors.Join(result, fmt.Errorf("cannot release Agent V2 credential refresh lock; keep agent-v2-credentials.json intact: %w", err))
			}
		}()
		if time.Until(deadline) <= 0 {
			return v2CredentialLockTimeout()
		}
		// A validated anchor is immutable: no crash window on successor acquisition.
		// Only first initialization or a proven-dead legacy migration writes metadata.
		if !initialized {
			if err = file.Truncate(0); err != nil {
				return err
			}
			if _, err = file.Seek(0, 0); err != nil {
				return err
			}
			if _, err = fmt.Fprintf(file, "%d %s\n", os.Getpid(), v2CredentialLockProtocol); err != nil {
				return err
			}
			if err = file.Sync(); err != nil {
				return err
			}
		}
		if time.Until(deadline) <= 0 {
			return v2CredentialLockTimeout()
		}
		return callback()
	}
}

func currentV2CredentialAnchor(file *os.File, path string) (bool, error) {
	opened, err := file.Stat()
	if err != nil {
		return false, err
	}
	current, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !opened.Mode().IsRegular() || !current.Mode().IsRegular() {
		return false, fmt.Errorf("Agent V2 credential refresh lock must be a regular file; keep agent-v2-credentials.json intact")
	}
	return os.SameFile(opened, current), nil
}

func v2CredentialLockTimeout() error {
	return fmt.Errorf("timed out waiting for Agent V2 credential refresh lock")
}
func waitV2CredentialLock(deadline time.Time) error {
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return v2CredentialLockTimeout()
	}
	if remaining > 50*time.Millisecond {
		remaining = 50 * time.Millisecond
	}
	time.Sleep(remaining)
	return nil
}
func legacyV2CredentialOwnerActive(file *os.File, fresh bool) (active, initialized bool, result error) {
	var data [256]byte
	n, err := file.ReadAt(data[:], 0)
	if err != nil && n == 0 {
		if errors.Is(err, io.EOF) {
			return !fresh, false, nil
		}
		return false, false, err
	}
	fields := strings.Fields(string(data[:n]))
	if len(fields) == 0 {
		return !fresh, false, nil
	}
	if len(fields) != 2 {
		return true, false, nil
	}
	parsedPID, e := strconv.ParseInt(fields[0], 10, 32)
	if e != nil || parsedPID <= 0 {
		return true, false, nil
	}
	if fields[1] == v2CredentialLockProtocol {
		return false, true, nil
	}
	if _, e = strconv.ParseInt(fields[1], 10, 64); e != nil {
		return true, false, nil
	}
	dead, e := v2CredentialProcessDead(int(parsedPID))
	if e != nil {
		return true, false, nil
	}
	return !dead, false, nil
}
