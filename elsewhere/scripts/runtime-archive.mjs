import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Three allowlisted regular files; standard ustar mode bits survive Windows builds.
export async function packRuntime(directory, names, destination) {
  const chunks = [];
  for (const name of names) {
    if (!/^(node(?:\.exe)?|elsewhere(?:\.exe)?|NODE-LICENSE\.txt)$/.test(name))
      throw new Error('Invalid runtime file');
    const data = await readFile(join(directory, name));
    const header = Buffer.alloc(512);
    const field = (offset, length, value) =>
      header.write(value, offset, length, 'ascii');
    field(0, 100, name);
    field(100, 8, '0000755\0');
    field(108, 8, '0000000\0');
    field(116, 8, '0000000\0');
    field(124, 12, data.length.toString(8).padStart(11, '0') + '\0');
    field(136, 12, '00000000000\0');
    header.fill(32, 148, 156);
    field(156, 1, '0');
    field(257, 6, 'ustar\0');
    field(263, 2, '00');
    const sum = header.reduce((a, b) => a + b, 0);
    field(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(chunks), { level: 9 });
  await writeFile(destination, compressed);
  return createHash('sha256').update(compressed).digest('hex');
}
