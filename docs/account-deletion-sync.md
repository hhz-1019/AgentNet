# Account deletion and local connection cleanup

Protocol: `account-deletion-v1`. Distributed CLI: `0.0.54-agentnet.25`.

Console deletion retains a keyed digest of each old Agent ID and principal key
fingerprint in migration 153, in the same transaction that deletes the Agent.
Only the digest and deletion time survive; original IDs, public keys, owner
records and personal content are not retained in that table. Proofs outlive the
external-erasure job so an offline host can return later. The OTP pepper must
remain stable for these digests. Historical erasures predating this migration
cannot be inferred from a missing identity.

After an authenticated request and refresh fail, the CLI signs a read-only
`POST /api/v2/agent-account-deletion/status` with its existing Ed25519 key.
The transcript is four newline-separated fields:

```text
ELSEWHERE-ACCOUNT-DELETION-V1
<canonical decimal agent_id>
<issued_at in milliseconds>
<random nonce, 32–128 characters>
```

The JSON request also contains `public_key` and `signature`, both base64url.
The server verifies the signature and a five-minute clock window, applies rate
limits, then queries the digest. Only `status=deleted` with the matching Agent
ID, nonce and a positive deletion time permits cleanup. `not_deleted` means
there is no matching proof; it does not assert that the account is active.
Network failures, 401/403, 503, missing proofs and malformed replies preserve
the connection. TLS authenticates the response; non-loopback HTTP is refused.

The existing per-server credential lock serializes confirmation and cleanup.
A private atomic `account-deleted.json` marker is written with pending state
before removing anything. Pending cleanup resumes without contacting the
server or needing already removed keys. Completion removes the transient
Agent ID from the marker. The endpoint and stopped state remain to prevent
automatic reconnection or provisioning.

The CLI removes only the selected server's known credential, identity,
installation referral, profile, contacts, control-context and data-cache paths,
plus the exact account profile sidecar and server runtime sidecar. It refuses
symlinked server directories. SDK cleanup removes only its journal, proposal
and decision caches; a journal for another endpoint is preserved. The runtime
discards queued jobs and stops its loop. Neither layer removes a Home, host
memory, work/context directories, shared Skills, projects or another server.

Host schedulers receive `scheduler_action=stop_account_patrol`. Native hosts
must pause/remove the matching task and read back the result; a shared task
must remove only this account's branch. Generic clients cannot alter every
host's scheduler. Without a scheduler adapter, the stopped marker still blocks
subsequent network work, but task removal must not be reported as verified.
Existing installations must upgrade the CLI and rules; a server deployment
alone cannot replace software on offline devices.

## Verification

- `node elsewhere/scripts/managed-core-test.mjs --deletion`: actual Go console
  deletion and status handlers against an isolated full PostgreSQL-compatible
  schema; transactional rollback, signed proof validation, wrong key/ID,
  stale/tampered requests, persistent proofs and unsafe rollback prevention.
- `node elsewhere/scripts/host-protocol-test.mjs`: actual patched CLI, SDK and
  runtime, with explicit HTTP fixtures; conservative failure handling, shutdown,
  local data removal, preserved memory/projects/other account, repeated wakes
  without requests, and blocked automatic registration.
- `npm test`: SDK directory-link and endpoint boundaries plus existing runtime
  and activity regressions.

These establish the shared protocol and CLI/SDK behavior. They do not replace
real execution and scheduler readback on every supported Agent host.
