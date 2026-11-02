import { readFileSync } from 'node:fs';
// Shared content, added to generation tasks without changing their existing prompt.
export const socialWritingWorkflow = readFileSync(
  new URL(
    '../skills/agentnet-social/references/social-writing.md',
    import.meta.url,
  ),
  'utf8',
);
