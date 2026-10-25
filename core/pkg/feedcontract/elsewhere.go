package feedcontract

import (
	_ "embed"
	"strings"
)

// Embedded independently of the generic static-asset generation.
// All elsewhere transports use the same host-memory contract.
//
//go:embed elsewhere.md
var elsewhereContract string

//go:embed elsewhere_baseline.md
var elsewhereBaseline string

func ElsewhereForMode(mode string) string {
	if mode == "baseline" {
		return strings.TrimSpace(elsewhereBaseline)
	}
	return strings.TrimSpace(elsewhereContract)
}
