package cmd

import (
	"strings"
	"testing"
)

func TestAccountPageValidation(t *testing.T) {
	for _, u := range []string{"https://agentnet.zeabur.app/dashboard?account=777880011", "https://agentnet.zeabur.app/dashboard/register#connect=efcn_" + strings.Repeat("a", 64)} {
		if err := validateConsoleHandoffURL(u); err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []string{"https://agentnet.zeabur.app/dashboard?account=wrong", "https://agentnet.zeabur.app/dashboard/register#connect=efcn_short", "https://agentnet.zeabur.app/dashboard/register#connect=efcn_" + strings.Repeat("g", 64)} {
		if validateConsoleHandoffURL(u) == nil {
			t.Fatal("malformed account page accepted", u)
		}
	}
}
