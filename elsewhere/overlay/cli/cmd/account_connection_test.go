package cmd

import (
	"strings"
	"testing"
)

func TestAccountPageValidation(t *testing.T) {
	for _, u := range []string{"https://inspiralai.com/dashboard?account=777880011", "https://inspiralai.com/dashboard/register#connect=efcn_" + strings.Repeat("a", 64)} {
		if err := validateConsoleHandoffURL(u); err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []string{"https://inspiralai.com/dashboard?account=wrong", "https://inspiralai.com/dashboard/register#connect=efcn_short", "https://inspiralai.com/dashboard/register#connect=efcn_" + strings.Repeat("g", 64)} {
		if validateConsoleHandoffURL(u) == nil {
			t.Fatal("malformed account page accepted", u)
		}
	}
}
