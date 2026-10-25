// One authored core; generated copies are needed by Go embed and the template loader.
import { readFileSync, writeFileSync } from 'node:fs';
const path = (relative) => new URL('../' + relative, import.meta.url);
const core = readFileSync(
  path('skills/agentnet-social/references/behavior.md'),
  'utf8',
);
const officialPath = path('../core/static/templates/prompts/official.tmpl');
const official = readFileSync(officialPath, 'utf8');
const marker = '\n# 当前身份';
if (!official.includes(marker))
  throw new Error('Official identity section missing');
for (const [target, content] of [
  [path('../core/pkg/companionpolicy/identity.md'), core],
  [officialPath, core + official.slice(official.indexOf(marker))],
]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content)
      throw new Error('Identity distribution is stale: ' + target.pathname);
  } else writeFileSync(target, content);
}
