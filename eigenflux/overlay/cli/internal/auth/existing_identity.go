package auth

import (
	"crypto/ed25519"
	"fmt"
	"os"
)

// A status check must never generate a replacement identity.
func LoadExistingIdentity(server string) (ed25519.PublicKey, ed25519.PrivateKey, error) {
	info, err := os.Lstat(identityPath(server))
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, nil, fmt.Errorf("identity must be a regular private file")
	}
	if err := validatePrivateFilePermissions(info); err != nil {
		return nil, nil, err
	}
	return loadIdentity(identityPath(server))
}
