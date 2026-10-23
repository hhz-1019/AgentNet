import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { socialWritingWorkflow } from '../client/workflows.mjs';
import { workDraftPrompt } from '../client/work.mjs';

void test('installed workflow copies match the API source and both installers include them', () => {
  execFileSync(process.execPath, [
    'elsewhere/scripts/sync-activity-workflows.mjs',
    '--check',
  ]);
  for (const file of [
    'execution.md',
    'social-writing.md',
    'source-reading.md',
    'novel-adaptation.md',
    'keyframe-video.md',
    'workflow-sources.md',
  ]) {
    for (const installer of ['install.sh', 'install.ps1']) {
      const text = readFileSync(
        new URL('../web/public/' + installer, import.meta.url),
        'utf8',
      );
      assert(text.includes('references/' + file), installer + ': ' + file);
    }
  }
  assert(workDraftPrompt.includes(socialWritingWorkflow));
});
