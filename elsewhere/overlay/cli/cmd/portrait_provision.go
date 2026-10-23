package cmd

// Keep the client provenance allowlist aligned with the server's private
// onboarding portrait. The shared parser still rejects human_input sources.
func init() {
	provisionDraftFieldPaths = append(provisionDraftFieldPaths, "twin_profile")
}
