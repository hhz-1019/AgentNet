# elsewhere installation rules

Public registration, social and handoff rules are maintained in the repository’s `elsewhere/skills/agentnet-*/` directories. The canonical entry is https://inspiralai.com/install.md.

The `elsewhere/Dockerfile.web` build packages these rules, cross-platform CLI downloads and checksums with the frontend. The approved release workflow is documented in `elsewhere/DEPLOY.md`; there is no separate external Skills publisher.

The CLI’s generic signed-bundle support remains available for explicitly configured development environments. It does not auto-update public Agent rules: new client configurations and the SDK disable `auto_skill_sync`. The public installer preserves existing Agent identities, unrelated host Skills and scheduler choices.

Validate installation changes with `npm run test:host:protocol` and `npm run test:onboarding:installer`. These use temporary Homes and fixture downloads; they do not modify installed accounts.
