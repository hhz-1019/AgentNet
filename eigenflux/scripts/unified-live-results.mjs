import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Evaluate database receipts, not the model's claim that an action succeeded.
export async function verifyUnifiedResults(directory) {
  const dir = resolve(directory);
  const load = async (name) =>
    JSON.parse(await readFile(resolve(dir, name), 'utf8'));
  const [data, rounds] = await Promise.all([
    load('results.json'),
    load('rounds.json'),
  ]);
  const actors = [...new Map(rounds.map((r) => [r.id, r])).values()].map(
    (actor) => {
      const own = data.receipts.filter(
        (r) => r.agent_id === actor.id && r.status < 400,
      );
      const posts = data.posts.filter(
        (p) =>
          p.agent_id === actor.id &&
          p.state === 'published' &&
          p.visibility === 'public',
      );
      const comments = data.comments.filter((c) => c.agent_id === actor.id);
      const checkpoints = own.filter((r) => r.tool === 'checkpoint');
      const reviews = data.reviews.filter((r) => r.agent_id === actor.id);
      const runs = rounds.filter((r) => r.id === actor.id);
      const failures = runs.filter((r) => r.error || r.result?.error);
      const continued = checkpoints.some((c) => c.result?.data?.revision >= 2);
      return {
        id: actor.id,
        kind: actor.kind,
        name: actor.name,
        posts: posts.length,
        comments: comments.length,
        illustrated_posts: posts.filter(p => p.document.media?.some(m => data.verified_media?.some(v => v.url === m.url && v.bytes > 0))).length,
        reviews: reviews.length,
        checkpoints: checkpoints.length,
        continued,
        rounds: runs.length,
        failures: failures.map((r) => ({
          round: r.round,
          error: r.error || r.result.error,
        })),
        passed:
          posts.length > 0 &&
          comments.length > 0 &&
          reviews.length > 0 &&
          continued &&
          posts.some(p => p.document.media?.some(m => data.verified_media?.some(v => v.url === m.url && v.bytes > 0))) &&
          runs.length >= 2 &&
          failures.length === 0,
      };
    },
  );
  const result = {
    passed: actors.length === 4 && actors.every((a) => a.passed),
    production_writes: data.production_writes,
    actors,
    scope:
      'Two manually triggered rounds; real provider and sources, isolated database. Not a 24-hour or all-vendor certification.',
  };
  await writeFile(
    resolve(dir, 'acceptance.json'),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verifyUnifiedResults(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
