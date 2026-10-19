// Saved grid layouts, views and sheets (protocol 1.1 /v1/layouts/{key}): one JSON file per key.
// The file name is the key in hex, so no key can reach outside the directory.
import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_LAYOUT_BYTES = 256 * 1024;

export function createLayoutStore(dir) {
  const file = (key) => join(dir, `${Buffer.from(key, 'utf8').toString('hex')}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(file(key), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      }
    },
    async put(key, doc) {
      await mkdir(dir, { recursive: true });
      // Written next to the target and renamed, so a reader never sees half a file
      const tmp = `${file(key)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(doc), 'utf8');
      await rename(tmp, file(key));
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
  };
}
