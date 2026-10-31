# Elsewhere 插件协作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在既有 Agent 软件内，通过 Elsewhere MCP 插件完成跨主人项目分工、执行、交付和验收。

**Architecture:** Go Core 保存项目事实并执行权限检查，客户端使用既有签名 CLI。独立宿主负责执行；MCP 会话执行是通用基线，额外后台能力按宿主显式声明。

**Tech Stack:** Go/Hertz/GORM/PostgreSQL; Node >=24.12.0; MCP SDK/Zod.

**Spec:** docs/superpowers/specs/2026-10-31-collaboration.md

## Global Constraints

- 保留现有身份、主人归属和 Agent Home；Go 是唯一业务真相源。
- 插件内完成主要工作，不要求新聊天产品或全量记忆上传。
- 修改仅限协作框架；保留现有未跟踪文件。
- 权限、租约、幂等和版本冲突必须由服务端检查。单宿主模拟与真实宿主分别报告。
- 新表前向兼容；无破坏性数据迁移。默认提交、推送、完整 CI 后统一发布。

## Task 1: 持久项目协作核心

**Files:** Create `core/api/consolev2/collaboration*.go`, `core/migrations/000157_collaboration.sql`; modify `core/api/consolev2/service.go`; create `elsewhere/scripts/collaboration-core-test.mjs`.

**Interfaces:** authenticated POST `/api/v2/collaboration/{project,membership,tasks,context,updates,submit,review}`; all requests contain `action` where relevant, optional `project_id`, write `idempotency_key` and `expected_version`. Response `{data: ...}` follows existing reply helper. Publish exact schemas in `docs/COLLABORATION_API.md` for client implementer.

- [ ] Add schema and transaction service: Project/Membership/Task/Run/Artifact/Review/Event, owner references from authenticated Agent, project lock serializes transitions, replay stored response only after current access check.
- [ ] Implement project create/list/get/invite/complete; membership accept/decline/restrict/revoke; tasks create/list/get/assign/accept/decline/start/heartbeat/block/cancel/recover; context read; updates read/publish; submit; review accept/changes_requested/reject.
- [ ] Enforce member scopes, fixed reviewers, dependency acceptance, no redelegation amplification, exact artifact versions, lease epoch/expiry, transactional event sequence and response idempotency. Invitations disclose only minimal offer until accepted. Initial sharing scope is whole project; no arbitrary fine-grained ACL claims. Artifact inline bounded text or HTTPS reference; never local path. Fail closed for ambiguous grant expansion.
- [ ] Test actual SQL with PGlite socket and patched Go harness, following social-core-test pattern. Cases: two independent owners; invited outsider cannot read context; accepted member completes run; unapproved predecessor blocks dependent; duplicate claim; stale epoch; duplicate key changed payload; read after revoke; rework old-version review; project only closes after accepted tasks.
- [ ] Compile Go and run targeted integration; document actual tool schema and limitations.

## Task 2: 可安装插件与宿主合同

**Files:** Create `core/cli/cmd/collaboration.go`, `elsewhere/client/collaboration.mjs`, `elsewhere/client/collaboration.test.mjs`, `elsewhere/client/collaboration-host.mjs`, `elsewhere/skills/agentnet-collaboration/SKILL.md`; modify `elsewhere/client/sdk.mjs`, `elsewhere/client/mcp.mjs`, installers/build packaging as discovered.

**Interfaces:** SDK methods `collaboration_project`, `collaboration_membership`, `collaboration_tasks`, `collaboration_context`, `collaboration_updates`, `collaboration_submit`, `collaboration_review`. MCP uses existing `network_` prefix. CLI `collaboration <group> --stdin` forwards validated bounded JSON through existing signed client. Exact server schema from Task 1.

- [ ] Add CLI and MCP schemas, reject unknown actions/fields and never silently strip authorization metadata.
- [ ] Add host capabilities contract and checkpoint event cursor persistence; unsupported external wake/resume/injection stays explicit. Default MCP session needs no new keys or runtime.
- [ ] Package collaboration skill with installer distribution and current release metadata. Do not install into the developer's live identity as a side effect.
- [ ] Test CLI route mapping, MCP tool discovery/calls, cursor redelivery and capability truthfulness; run existing client regressions.

## Task 3: 审查、验收与发布

**Files:** Update `docs/COLLABORATION.md`, `elsewhere/VERIFICATION.md`, `package.json`, CI workflow and release metadata where needed.

- [ ] Review core and plugin boundaries independently; fix findings before release.
- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, new core/plugin integration and relevant existing protocol tests. Add core test to CI.
- [ ] Record source attribution: OpenAgents adapter pattern; Beads ready/claim/dependencies; AgentRadio checkpoint findings; Agora immutable provenance; A2A deferred gateway. No new dependency is implied by conceptual reuse.
- [ ] Inspect actual available host interfaces and report protocol tests vs real host runs separately. Do not manufacture owners, credentials, cloud availability or desktop support.
- [ ] Commit scoped changes, integrate remote safely, push; wait complete CI then use `npm run deploy:hk`. Verify release revision or report concrete blocking evidence.

## Scope resolution

The approved design explicitly stages A2A gateway after the internal loop. This implementation establishes that loop first. Console is auxiliary and receives no mandatory new workflow. Fine-grained resource scope and unattended host runners require separate concrete host support; initial project membership shares only explicitly submitted project data and executes in the active MCP session. These limits must appear in capability documentation, not be represented as implemented coverage.
