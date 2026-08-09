'use client';

import { useEffect, useState } from 'react';
import {
  type AccountSession,
  deleteAccountPrivacy,
  exportAccountPrivacy,
  listAccountSessions,
  revokeAccountSession,
  revokeOtherAccountSessions,
} from '../api/account-privacy.client';

export function AccountPrivacyPanel() {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [message, setMessage] = useState<string>('Загрузка сессий…');
  const [confirmation, setConfirmation] = useState('');

  async function refresh() {
    try {
      const result = await listAccountSessions();
      setSessions(result.sessions);
      setMessage('Сессии загружены.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить сессии.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function act(label: string, fn: () => Promise<unknown>) {
    setMessage(`${label}…`);
    try {
      const result = await fn();
      setMessage(`${label}: готово${label === 'Экспорт' ? ` ${JSON.stringify(result).slice(0, 180)}…` : ''}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Операция не выполнена.');
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Приватность и сессии</h2>
      <p className="mt-2 text-sm text-slate-600">
        Управление активными входами, экспортом данных и удалением аккаунта. Для экспорта и удаления нужен свежий повторный вход.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => void act('Экспорт', exportAccountPrivacy)}>
          Экспортировать мои данные
        </button>
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={() => void act('Отзыв других сессий', revokeOtherAccountSessions)}>
          Выйти на других устройствах
        </button>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span>
              {session.current ? 'Текущая сессия' : 'Сессия'} · создана {new Date(session.createdAt).toLocaleString('ru-RU')}
              {session.revokedAt ? ' · отозвана' : ''}
            </span>
            {!session.current && !session.revokedAt ? (
              <button className="rounded-lg border border-slate-300 px-3 py-1" onClick={() => void act('Отзыв сессии', () => revokeAccountSession(session.id))}>
                Отозвать
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
        <h3 className="font-semibold text-red-900">Удаление аккаунта</h3>
        <p className="mt-1 text-sm text-red-800">
          Введите точную фразу <code>DELETE MY ACCOUNT</code>. Активные права доступа будут отозваны, личные данные удалены или анонимизированы по реестру AUTH-01B.
        </p>
        <input
          className="mt-3 w-full rounded-lg border border-red-200 px-3 py-2 text-sm"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="DELETE MY ACCOUNT"
        />
        <button className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white" onClick={() => void act('Удаление аккаунта', () => deleteAccountPrivacy(confirmation))}>
          Удалить аккаунт
        </button>
      </div>
      <p className="mt-4 text-sm text-slate-600" role="status">{message}</p>
    </section>
  );
}
