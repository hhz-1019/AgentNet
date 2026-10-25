// One maintained implementation; copies travel with hosts that cannot read the Go tree.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const files = [
  ['execution.md', 'execution.md'],
  ['workflows/social-writing.md', 'social-writing.md'],
  ['workflows/source-reading.md', 'source-reading.md'],
  ['workflows/novel-adaptation.md', 'novel-adaptation.md'],
  ['workflows/keyframe-video.md', 'keyframe-video.md'],
  ['workflows/SOURCES.md', 'workflow-sources.md'],
];
for (const [source, target] of files) {
  const text = readFileSync(
    new URL('../core/pkg/companionpolicy/' + source, root),
    'utf8',
  );
  const path = new URL('skills/agentnet-social/references/' + target, root);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== text)
      throw Error('Workflow distribution differs: ' + target);
  } else writeFileSync(path, text);
}
