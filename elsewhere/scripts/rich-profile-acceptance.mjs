// Compatibility entry for the retired rich-profile acceptance command.
// All current profile validation is local; no personal archive or cloud model call.
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  [
    '--test',
    'elsewhere/web/onboarding-prefill.test.ts',
    'elsewhere/scripts/host-memory-contract.test.mjs',
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
