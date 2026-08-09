'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './messages/en';
import { ru } from './messages/ru';
import { enContent } from './content/en';
import { ruContent } from './content/ru';
import { formatContentLabel, type ContentNamespace } from './content/types';
import type { AppLocale, MessageKey, Messages } from './types';
import { getUserProfile, putUserProfile } from '../features/user-profile/api/user-profile.client';
import { useAuth } from '../features/auth/components/auth-provider';

const STORAGE_KEY = 'weight-app.locale';
const dictionaries: Record<AppLocale, Messages> = { ru, en };
const contentDictionaries = { ru: ruContent, en: enContent };

type LocaleContextValue = {
  locale: AppLocale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  tc: (namespace: ContentNamespace, key: string) => string;
  setLocale: (locale: AppLocale, options?: { persist?: boolean }) => Promise<void>;
  ready: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const MISSING_KEY_FALLBACK: Record<AppLocale, string> = {
  ru: 'Не удалось показать текст',
  en: 'Unable to display text',
};

function applyDocumentLang(locale: AppLocale) {
  if (typeof document !== 'undefined') {
    // BCP 47 primary language subtags for screen readers / axe.
    document.documentElement.lang = locale === 'en' ? 'en' : 'ru';
  }
}

export function resolveMessage(
  locale: AppLocale,
  key: MessageKey,
  dictionaries: Record<AppLocale, Messages>,
): string {
  const primary = dictionaries[locale][key];
  if (typeof primary === 'string' && primary.length > 0) return primary;

  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`MISSING_I18N:${String(key)}`);
  }
  // Never cross locale boundaries or expose translation keys in production UI.
  return MISSING_KEY_FALLBACK[locale];
}

export function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') return 'ru';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' ? 'en' : 'ru';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [locale, setLocaleState] = useState<AppLocale>('ru');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    applyDocumentLang(initial);
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      setReady(true);
      return;
    }
    getUserProfile()
      .then((profile) => {
        if (!profile) return;
        const next = profile.locale === 'en' ? 'en' : 'ru';
        setLocaleState(next);
        localStorage.setItem(STORAGE_KEY, next);
        applyDocumentLang(next);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [status]);

  const setLocale = useCallback(async (next: AppLocale, options?: { persist?: boolean }) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyDocumentLang(next);
    if (options?.persist === false) return;
    try {
      const profile = await getUserProfile();
      if (!profile) return;
      await putUserProfile({
        displayName: profile.displayName,
        ageYears: profile.ageYears,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        activityLevel: profile.activityLevel,
        locale: next,
        trainingLevel: profile.trainingLevel ?? null,
        workoutsPerWeek: profile.workoutsPerWeek ?? null,
        dietaryPreferences: profile.dietaryPreferences ?? null,
        foodRestrictions: profile.foodRestrictions ?? null,
        availableEquipment: profile.availableEquipment ?? null,
        allergenCodes: profile.allergenCodes ?? [],
        dietaryCodes: profile.dietaryCodes ?? [],
        intoleranceCodes: profile.intoleranceCodes ?? [],
        preferredProductIds: profile.preferredProductIds ?? [],
        dislikedProductIds: profile.dislikedProductIds ?? [],
        equipmentCodes: profile.equipmentCodes ?? [],
      });
    } catch {
      // Profile may not exist yet; localStorage still keeps the choice until onboarding save.
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let value = resolveMessage(locale, key, dictionaries);
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return value;
    },
    [locale],
  );

  const tc = useCallback(
    (namespace: ContentNamespace, key: string) => {
      // Content catalogs are open-ended (product/meal names from DB). Never throw
      // MISSING_I18N_CONTENT for unknown keys — fall back to the API/display string.
      return formatContentLabel(namespace, key, contentDictionaries[locale], contentDictionaries[locale]);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, t, tc, setLocale, ready }), [locale, t, tc, setLocale, ready]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('I18N_PROVIDER_MISSING');
  return ctx;
}
