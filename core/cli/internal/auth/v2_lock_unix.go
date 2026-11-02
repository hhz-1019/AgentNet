//go:build !windows

package auth

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func tryV2CredentialFileLock(file *os.File) (bool, error) {
	err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
		return false, nil
	}
	return false, err
}
func unlockV2CredentialFile(file *os.File) error { return unix.Flock(int(file.Fd()), unix.LOCK_UN) }
func v2CredentialProcessDead(pid int) (bool, error) {
	err := unix.Kill(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return true, nil
	}
	return false, err
}
