package tradebff

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"testing"
	"time"
)

func TestDelegationGoldenVector(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index)
	}
	delegator, err := NewDelegator("test-2026", base64.RawURLEncoding.EncodeToString(seed))
	if err != nil {
		t.Fatal(err)
	}
	delegator.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	delegator.random = bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15})
	token, err := delegator.Token(DelegationRequest{AgentID: 42, Scope: "wallet:read", Method: http.MethodGet, Operation: "wallet.balance.read"})
	if err != nil {
		t.Fatal(err)
	}
	const expected = "efd1_test-2026.eyJ2ZXIiOjEsImlzcyI6ImVsc2V3aGVyZS1hcGkiLCJhdWQiOiJlbHNld2hlcmUtY29tbWlzc2lvbiIsInN1YiI6IjQyIiwic2NvcGUiOiJ3YWxsZXQ6cmVhZCIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDMwLCJqdGkiOiIwMDAxMDIwMzA0MDUwNjA3MDgwOTBhMGIwYzBkMGUwZiIsIm1ldGhvZCI6IkdFVCIsIm9wZXJhdGlvbiI6IndhbGxldC5iYWxhbmNlLnJlYWQifQ.Y2E4L5HBjXnSikdB0ABJZ_bLXHtrms-z8VMhj8QXCgWloEpraPkr1bQkMUU0RWu1u2ABw2T750Qhk1OomkdFBg"
	if token != expected {
		t.Fatalf("token contract drifted:\n%s", token)
	}
}
