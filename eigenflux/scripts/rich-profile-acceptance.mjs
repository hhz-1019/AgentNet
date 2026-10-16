// Compatibility entry for the retired rich-profile acceptance command.
// All current profile validation is local; no personal archive or cloud model call.
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  [
    '--test',
    'eigenflux/web/onboarding-prefill.test.ts',
    'eigenflux/scripts/host-memory-contract.test.mjs',
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
