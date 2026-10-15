package cmd

import (
	"encoding/hex"
	"net/url"
	"strconv"
	"strings"
)

func validAccountPageURL(u *url.URL) bool {
	if u.User != nil {
		return false
	}
	if u.Path == "/dashboard" {
		n, err := strconv.ParseInt(u.Query().Get("account"), 10, 64)
		return err == nil && n >= 10000 && u.Fragment == ""
	}
	if u.Path != "/dashboard/register" || u.RawQuery != "" {
		return false
	}
	fragment, err := url.ParseQuery(u.Fragment)
	if err != nil {
		return false
	}
	key := fragment.Get("connect")
	if !strings.HasPrefix(key, "efcn_") || len(key) != 69 {
		return false
	}
	_, err = hex.DecodeString(strings.TrimPrefix(key, "efcn_"))
	return err == nil
}
