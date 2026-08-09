import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';

@Injectable()
export class BackupObjectStorage {
  private readonly rootDir = process.env.BACKUP_STORAGE_ROOT?.trim() || resolve(process.cwd(), '.data', 'backups');

  async put(storageKey: string, body: Buffer): Promise<void> {
    const full = this.resolveKey(storageKey);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  resolveKey(storageKey: string): string {
    if (!storageKey || storageKey.includes('..') || storageKey.startsWith('/') || storageKey.startsWith('\\')) {
      throw new Error('BACKUP_STORAGE_KEY_INVALID');
    }
    const full = resolve(join(this.rootDir, storageKey));
    if (!full.startsWith(resolve(this.rootDir))) throw new Error('BACKUP_STORAGE_KEY_INVALID');
    return full;
  }
}
