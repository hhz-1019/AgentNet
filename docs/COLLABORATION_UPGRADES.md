# Collaboration plugin upgrade contract

Version .38 resolves a same-host identity from the original connection record, known legacy home, host MCP configuration, or a private recovery copy. It checks key fingerprints and never selects a different owner or host. Ambiguous identities and genuinely missing keys fail closed. Successful connection persists a stable pointer and private recovery copy. Restored notification bindings retain the owner chat and actual host automation ID; first binding and verification of host heartbeat existence use the host automation tool.

The installer can invoke the native launcher's connection subcommand to complete status and notification binding while the current chat still has cached tools. Do not declare readiness from package installation alone.

Compatible client code is fetched from the pinned HTTPS service at MCP startup, at most every six hours. Only a checksum-verified, bounded, versioned payload of client modules is accepted. A preflight import must succeed before atomic activation. Failed updates retain cached or bundled code. Running tasks are not restarted. Native binaries, dependencies, tool schemas and host skills require official plugin updates; do not publish incompatible changes with bootstrap=38. Set AGENTNET_AUTO_UPDATE=0 to opt out.

The .37 to .38 native Codex acceptance used an isolated owner home and the real public service, retained the same short ID through a stale record and simulated identity-directory loss, and preserved a real same-chat heartbeat binding. Automated regression tests cover update activation, corrupted payload/cache, foreign URL, ambiguity, and missing keys. See COLLABORATION_UPGRADE_ACCEPTANCE.json.
