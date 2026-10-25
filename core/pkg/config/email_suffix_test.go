package config

import (
	"fmt"
	"testing"
)

var controlledPGCTestPatterns = []string{
	"kairui[0-9]@pgc.elsewhere.internal",
	"kairui[1-9][0-9]@pgc.elsewhere.internal",
	"lingan[0-9]@pgc.elsewhere.internal",
	"lingan[1-9][0-9]@pgc.elsewhere.internal",
	"weici[0-9]@pgc.elsewhere.internal",
	"weici[1-9][0-9]@pgc.elsewhere.internal",
	"vic[0-9]@pgc.elsewhere.internal",
	"vic[1-9][0-9]@pgc.elsewhere.internal",
}

func TestEmailMatchesAnySuffix(t *testing.T) {
	suffixes := []string{"@eftestbot.com", "kairui1@pgc.example.com"}
	cases := []struct {
		email string
		want  bool
	}{
		{"bot1@eftestbot.com", true},
		{"BOT1@EFTestBot.com", true}, // case-insensitive
		{"  spaced@eftestbot.com  ", true},
		{"real@gmail.com", false},
		{"eftestbot.com@gmail.com", false}, // suffix must be at the end
		{"", false},
		{"kairui1@pgc.example.com", true},   // full-address entry matches exactly
		{"KaiRui1@pgc.example.com", true},   // exact match is case-insensitive
		{"xkairui1@pgc.example.com", false}, // full-address entry must not match by suffix
		{"kairui2@pgc.example.com", false},  // other addresses on the same domain don't match
	}
	for _, c := range cases {
		if got := EmailMatchesAnySuffix(c.email, suffixes); got != c.want {
			t.Errorf("EmailMatchesAnySuffix(%q) = %v, want %v", c.email, got, c.want)
		}
	}
	if EmailMatchesAnySuffix("x@eftestbot.com", nil) {
		t.Error("no suffixes configured should never match")
	}
}

func TestEmailMatchesAnyPattern(t *testing.T) {
	patterns := []string{
		"@eftestbot.com",
		"exact@example.com",
	}
	patterns = append(patterns, controlledPGCTestPatterns...)
	cases := []struct {
		email string
		want  bool
	}{
		{"bot1@eftestbot.com", true},
		{"kairui1@pgc.elsewhere.internal", true},
		{"KAIRUI12@PGC.ELSEWHERE.INTERNAL", true},
		{"  kairui9@pgc.elsewhere.internal  ", true},
		{"weici0@pgc.elsewhere.internal", true},
		{"weici99@pgc.elsewhere.internal", true},
		{"lingan7@pgc.elsewhere.internal", true},
		{"lingan42@pgc.elsewhere.internal", true},
		{"vic0@pgc.elsewhere.internal", true},
		{"vic99@pgc.elsewhere.internal", true},
		{"exact@example.com", true},
		{"kairui@pgc.elsewhere.internal", false},
		{"kairuia@pgc.elsewhere.internal", false},
		{"kairui123@pgc.elsewhere.internal", false},
		{"kairui09@pgc.elsewhere.internal", false},
		{"xkairui1@pgc.elsewhere.internal", false},
		{"kairui1@other.example", false},
	}
	for _, c := range cases {
		if got := EmailMatchesAnyPattern(c.email, patterns); got != c.want {
			t.Errorf("EmailMatchesAnyPattern(%q) = %v, want %v", c.email, got, c.want)
		}
	}
	if EmailMatchesAnyPattern("anything@example.com", []string{"[invalid"}) {
		t.Error("invalid glob patterns must fail closed")
	}
}

func TestControlledPGCTestPatternsCoverZeroThroughNinetyNine(t *testing.T) {
	for _, prefix := range []string{"kairui", "lingan", "weici", "vic"} {
		for suffix := 0; suffix <= 99; suffix++ {
			email := fmt.Sprintf("%s%d@pgc.elsewhere.internal", prefix, suffix)
			if !EmailMatchesAnyPattern(email, controlledPGCTestPatterns) {
				t.Fatalf("controlled test account did not match: %s", email)
			}
		}
		for _, invalid := range []string{
			prefix + "@pgc.elsewhere.internal",
			prefix + "00@pgc.elsewhere.internal",
			prefix + "09@pgc.elsewhere.internal",
			prefix + "100@pgc.elsewhere.internal",
		} {
			if EmailMatchesAnyPattern(invalid, controlledPGCTestPatterns) {
				t.Fatalf("invalid controlled test account matched: %s", invalid)
			}
		}
	}
}
