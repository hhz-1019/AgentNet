# elsewhere core development

Follow the repository root AGENTS.md.

- Keep the HTTP, CLI and host contracts aligned. Preserve credential and database compatibility.
- Root Go module: `elsewhere_server`; CLI module: `elsewhere.local/cli`. Keep these modules separate.
- Build outputs belong in ignored `build/` directories.
- Update IDL and generated types together when contracts change.
- Use the root npm scripts for isolated database, authentication and host protocol acceptance.
- Public onboarding rules live in `../elsewhere/skills/agentnet-onboarding`; social rules live in `../elsewhere/skills/agentnet-social`.
- Deployment uses `../elsewhere/DEPLOY.md`; no other product's deployment or publishing scripts apply.
