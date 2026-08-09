import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StoredExportObject } from '../domain/export-document.types';

@Injectable()
export class LocalObjectStorage {
  private readonly rootDir: string;

  constructor() {
    // Avoid Nest design:paramtypes treating a string path as an injectable token.
    this.rootDir = defaultRoot();
  }

  async put(
    userId: string,
    jobId: string,
    fileName: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredExportObject> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${userId}/${jobId}/${safeName}`;
    const fullPath = this.resolveKey(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);
    return { storageKey, contentType, byteLength: body.byteLength, fileName: safeName };
  }

  async get(storageKey: string): Promise<{ body: Buffer; contentType: string }> {
    const fullPath = this.resolveKey(storageKey);
    const body = await readFile(fullPath);
    const contentType = storageKey.endsWith('.pdf')
      ? 'application/pdf'
      : storageKey.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'application/octet-stream';
    return { body, contentType };
  }

  resolveKey(storageKey: string): string {
    if (!storageKey || storageKey.includes('..') || storageKey.startsWith('/') || storageKey.includes('\\')) {
      throw new Error('EXPORT_STORAGE_KEY_INVALID');
    }
    const full = resolve(join(this.rootDir, storageKey));
    if (!full.startsWith(resolve(this.rootDir))) throw new Error('EXPORT_STORAGE_KEY_INVALID');
    return full;
  }
}

function defaultRoot(): string {
  return process.env.EXPORT_STORAGE_ROOT?.trim() || resolve(process.cwd(), '.data', 'exports');
}
