# elsewhere core

Go services and the CLI for elsewhere. This source is maintained directly in the project repository.

- Root module: API, RPC, WebSocket, pipeline, shared packages and migrations.
- CLI module: `cli/`; module name `elsewhere.local/cli`.
- Product frontend, host adapters, installation rules and deployment: `../elsewhere/`.
- Architecture and interfaces: [project docs](../docs/ARCHITECTURE.md).
- Deployment: [DEPLOY.md](../elsewhere/DEPLOY.md).

Build the service stack with `bash scripts/common/build.sh` or the project Dockerfiles. Use the root npm acceptance scripts for isolated protocol and database tests. The public installation entry is https://inspiralai.com/install.md.

Copyright elsewhere. See [LICENSE](LICENSE).
