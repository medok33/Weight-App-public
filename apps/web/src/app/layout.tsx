import type { ReactNode } from 'react';
import '../styles/globals.css';
import { AppShell } from '../components/app-shell';
import { LocaleProvider } from '../i18n/locale-provider';
import { AuthProvider } from '../features/auth/components/auth-provider';

export const metadata = {
  title: 'Weight App',
  description: 'Безопасное и устойчивое управление весом',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <LocaleProvider>
            <AppShell>{children}</AppShell>
          </LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
