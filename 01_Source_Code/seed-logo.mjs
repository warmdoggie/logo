import {readFileSync} from 'node:fs';

const fallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

export function readSeedLogo() {
  try {
    return readFileSync(new URL('./seed/rae-logo.png', import.meta.url));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return Buffer.from(fallback);
  }
}
