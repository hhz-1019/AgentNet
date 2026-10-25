package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
)

// ResolveHome keeps the existing Elsewhere identity when an installation used
// a different directory name. Only the explicitly selected parent is inspected;
// unrelated product Homes and directories outside it are never adopted.
func ResolveHome(dir string) (string, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(dir, "config.json")); err == nil {
		return dir, nil
	}
	target := dir
	if filepath.Base(dir) != homeDirName {
		target = filepath.Join(dir, homeDirName)
	}
	parent := filepath.Dir(target)
	entries, err := os.ReadDir(parent)
	if os.IsNotExist(err) {
		return target, nil
	}
	if err != nil {
		return "", err
	}
	var matches []string
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		candidate := filepath.Join(parent, entry.Name())
		data, err := os.ReadFile(filepath.Join(candidate, "config.json"))
		if err != nil {
			continue
		}
		var cfg Config
		if json.Unmarshal(data, &cfg) != nil {
			continue
		}
		for _, server := range cfg.Servers {
			u, err := url.Parse(server.Endpoint)
			if err != nil || (server.Name != "agentnet" && server.Name != "elsewhere") {
				continue
			}
			ownedOrigin := u.Hostname() == "inspiralai.com" || u.Hostname() == "elsewhere.twintalk.cn" || u.Hostname() == "agentnet.zeabur.app" || u.Hostname() == "agentnet-next.zeabur.app"
			if u.Scheme == "https" && ownedOrigin {
				matches = append(matches, candidate)
				break
			}
		}
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("multiple Elsewhere Homes found; select the existing identity with --homedir")
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	return target, nil
}
