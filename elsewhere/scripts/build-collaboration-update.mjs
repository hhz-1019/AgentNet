// Publish a small compatible client payload, never native binaries or local data.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateUpdate } from '../client/collaboration-update.mjs';
const root = resolve(process.argv[2]),
  output = resolve(process.argv[3]);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const files = {};
for (const name of (await readdir(join(root, 'elsewhere/client'))).sort()) {
  if (/^[a-z][a-z0-9-]*\.mjs$/.test(name) && !name.endsWith('.test.mjs'))
    files['elsewhere/client/' + name] = await readFile(
      join(root, 'elsewhere/client', name),
      'utf8',
    );
}
const payload = validateUpdate({
  format: 1,
  bootstrap: 38,
  version: pkg.version,
  files,
});
const bytes = Buffer.from(JSON.stringify(payload));
if (bytes.length > 4 * 1024 * 1024) throw Error('Payload too large');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const name = 'client-' + pkg.version + '.json';
await mkdir(output, { recursive: true });
await writeFile(join(output, name), bytes);
await writeFile(
  join(output, 'update.json'),
  JSON.stringify({
    bootstrap: 38,
    version: pkg.version,
    sha256,
    url: 'https://collab.gongshi.world/plugin/' + name,
  }),
);
console.log(
  JSON.stringify({ version: pkg.version, sha256, bytes: bytes.length }),
);
