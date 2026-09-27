import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Replace this adapter to migrate from local disk to object storage.
export class LocalStorage {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true }); }
  put(bytes, ext) { const key = `${randomUUID()}.${ext}`; writeFileSync(join(this.root, key), bytes, {flag:'wx'}); return key; }
  get(key) { if (!/^[a-f0-9-]+\.(png|jpg|webp|svg)$/.test(key)) throw new Error('Invalid key'); return readFileSync(join(this.root, key)); }
  remove(key) { try { unlinkSync(join(this.root, key)); } catch {} }
}
