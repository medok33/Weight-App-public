'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/locale-provider';

export default function HomePage() {
  const { t } = useI18n();
  return (
    <main>
      <h1>{t('brand')}</h1>
      <p>{t('home.subtitle')}</p>
      <nav aria-label={t('home.navigation')}>
        <ul>
          <li><Link href="/dashboard-today">{t('nav.today')}</Link></li>
          <li><Link href="/meal-plan">{t('nav.nutrition')}</Link></li>
          <li><Link href="/workout-engine">{t('nav.workouts')}</Link></li>
          <li><Link href="/shopping-list">{t('nav.shopping')}</Link></li>
          <li><Link href="/progress">{t('nav.progress')}</Link></li>
          <li><Link href="/assistant">{t('nav.assistant')}</Link></li>
        </ul>
      </nav>
    </main>
  );
}
