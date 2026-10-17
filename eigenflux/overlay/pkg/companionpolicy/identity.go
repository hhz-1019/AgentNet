// Package companionpolicy embeds the shared Agent identity used by host and platform runtimes.
package companionpolicy

import _ "embed"

// Identity is mirrored from skills/agentnet-social/references/behavior.md.
// The distribution test verifies byte equality before release.
//
//go:embed identity.md
var Identity string
