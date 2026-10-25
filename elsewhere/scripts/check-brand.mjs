import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';

// Check tracked and new authored files, never caches, generated artifacts or
// private environment files. Match both historical spellings, ignoring case.
const retiredBrand = /(?:eigen|engine)[ ._-]*flux|\bef-(?:broadcast|communication|onboarding|profile)\b/i;
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const violations = [];
for (const file of files) {
  if (!existsSync(file) || !lstatSync(file).isFile()) continue;
  const data = readFileSync(file);
  if (retiredBrand.test(file) || (!data.includes(0) && retiredBrand.test(data.toString('utf8')))) violations.push(file);
}
assert.deepEqual(violations, [], 'Retired product branding in project source');
assert.equal(existsSync('.gitmodules'), false, 'Core must be maintained in this repository');
assert.match(readFileSync('core/go.mod', 'utf8'), /^module elsewhere_server\n/);
assert.match(readFileSync('core/cli/go.mod', 'utf8'), /^module elsewhere\.local\/cli\n/);
assert.match(readFileSync('core/cli/internal/config/config.go', 'utf8'), /Endpoint:\s+"https:\/\/inspiralai\.com"/);
console.log('PASS: elsewhere branding, native core modules and product origin');
