import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../messages/en';
import { ru } from '../messages/ru';
import { readStoredLocale, resolveMessage } from '../locale-provider';
import type { Messages } from '../types';

describe('locale dictionaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps RU and EN keys identical and values non-empty', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const dictionary of [ru, en]) {
      for (const value of Object.values(dictionary)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('does not resolve a missing key from another locale', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const dictionaries = {
      ru: { brand: '' } as Messages,
      en: { brand: 'English fallback must not leak' } as Messages,
    };
    expect(() => resolveMessage('ru', 'brand', dictionaries)).toThrow('MISSING_I18N:brand');
  });

  it('restores the persisted locale and safely defaults invalid values to RU', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
    });

    storage.set('weight-app.locale', 'en');
    expect(readStoredLocale()).toBe('en');
    storage.set('weight-app.locale', 'de');
    expect(readStoredLocale()).toBe('ru');
  });
});
