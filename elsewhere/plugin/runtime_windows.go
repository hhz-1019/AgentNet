package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Archives are bundled with the plugin. No network or account state is involved.
func runtimeDirectory(root string) (string, error) {
	data, err := os.ReadFile(filepath.Join(root, "runtime-archives.json"))
	if err != nil {
		return "", err
	}
	var hashes map[string]string
	if err = json.Unmarshal(data, &hashes); err != nil {
		return "", err
	}
	digest := hashes["windows-amd64"]
	if decoded, e := hex.DecodeString(digest); e != nil || len(decoded) != 32 {
		return "", fmt.Errorf("invalid runtime digest")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	parent := filepath.Join(home, ".elsewhere", "plugin-runtimes")
	target := filepath.Join(parent, digest)
	if _, err = os.Stat(filepath.Join(target, "ready")); err == nil {
		return target, nil
	}
	if err = os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	file, err := os.Open(filepath.Join(root, "runtime", "windows-amd64.tar.gz"))
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return "", fmt.Errorf("runtime integrity mismatch")
	}
	if _, err = file.Seek(0, 0); err != nil {
		return "", err
	}
	gz, err := gzip.NewReader(file)
	if err != nil {
		return "", err
	}
	defer gz.Close()
	stage, err := os.MkdirTemp(parent, "unpack-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	expected := map[string]bool{"node.exe": false, "elsewhere.exe": false, "NODE-LICENSE.txt": false}
	reader := tar.NewReader(gz)
	for {
		header, e := reader.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return "", e
		}
		seen, allowed := expected[header.Name]
		if !allowed || seen || header.Typeflag != tar.TypeReg || header.Size < 0 || header.Size > 256*1024*1024 {
			return "", fmt.Errorf("invalid runtime archive entry")
		}
		out, e := os.OpenFile(filepath.Join(stage, header.Name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
		if e != nil {
			return "", e
		}
		_, e = io.Copy(out, reader)
		closeError := out.Close()
		if e != nil {
			return "", e
		}
		if closeError != nil {
			return "", closeError
		}
		expected[header.Name] = true
	}
	for _, found := range expected {
		if !found {
			return "", fmt.Errorf("incomplete runtime archive")
		}
	}
	if err = os.WriteFile(filepath.Join(stage, "ready"), []byte(digest), 0600); err != nil {
		return "", err
	}
	if err = os.Rename(stage, target); err != nil {
		if _, check := os.Stat(filepath.Join(target, "ready")); check != nil {
			return "", err
		}
	}
	return target, nil
}
