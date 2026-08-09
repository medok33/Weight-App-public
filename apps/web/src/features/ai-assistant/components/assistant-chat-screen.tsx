'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAssistantContext,
  getAssistantProviderStatus,
  getAssistantUsage,
  listConversations,
  listMessageFeedback,
  listMessages,
  sendMessage,
  submitMessageFeedback,
} from '../api/ai-assistant.client';
import type { ChatMessage, ContextUiLabels, Conversation, MessageFeedbackRating } from '../model/ai-assistant.types';
import { apiErrorMessage } from '@/lib/api-fetch';
import { useAuth } from '@/features/auth/components/auth-provider';
import { isOwnerRole } from '@/lib/auth';
import { useI18n } from '@/i18n/locale-provider';
import { AssistantRichText, localizeContentKeys } from './assistant-rich-text';
import './assistant-chat.css';

type ScreenState = 'loading' | 'ready' | 'error';

type UsageState = {
  requestCount: number;
  dailyLimit: number;
  tariff: string;
  quotaMode?: string;
  providerId?: string;
};

const QUICK_ACTION_IDS = ['cook', 'ration', 'plateau', 'workout', 'budget'] as const;

function formatTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function providerLabel(providerId?: string): string | null {
  if (!providerId) return null;
  const id = providerId.toLowerCase();
  if (id.includes('deepseek')) return 'DeepSeek';
  if (id === 'local') return 'Local';
  if (id.includes('openai')) return 'OpenAI';
  return providerId;
}

export function AssistantChatScreen() {
  const { t, tc, locale } = useI18n();
  const { user } = useAuth();
  const owner = isOwnerRole(user?.role);
  const isDev = process.env.NODE_ENV !== 'production';

  const [state, setState] = useState<ScreenState>('loading');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryContent, setRetryContent] = useState<string | null>(null);
  const [contextUi, setContextUi] = useState<ContextUiLabels | null>(null);
  const [feedback, setFeedback] = useState<Record<string, MessageFeedbackRating>>({});
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [showQuick, setShowQuick] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const quickActions = useMemo(
    () =>
      QUICK_ACTION_IDS.map((id) => ({
        id,
        label: t(`assistant.quick.${id}`),
        text: t(`assistant.quick.${id}.prompt`),
      })),
    [t],
  );

  const loadConversations = useCallback(async () => {
    const items = await listConversations();
    setConversations(items);
    if (items.length > 0) {
      setActiveId((current) => current ?? items[0]!.id);
    }
    setState('ready');
  }, []);

  const loadFeedback = useCallback(async (items: ChatMessage[]) => {
    const assistantIds = items.filter((m) => m.role === 'assistant').map((m) => m.id);
    if (assistantIds.length === 0) return;
    try {
      const map = await listMessageFeedback(assistantIds);
      setFeedback(map);
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    Promise.all([
      loadConversations(),
      getAssistantContext().then((ctx) => setContextUi(ctx.ui)),
      getAssistantUsage()
        .then((u) =>
          setUsage({
            requestCount: Number(u.requestCount ?? 0),
            dailyLimit: Number(u.dailyLimit ?? 0),
            tariff: String(u.tariff ?? user?.tier ?? 'FREE'),
            quotaMode: typeof u.quotaMode === 'string' ? u.quotaMode : undefined,
            providerId: typeof u.providerId === 'string' ? u.providerId : undefined,
          }),
        )
        .catch(() => undefined),
      owner && isDev
        ? getAssistantProviderStatus()
            .then((status) => {
              if (!status?.selectedProvider) return;
              setUsage((prev) => ({
                requestCount: prev?.requestCount ?? 0,
                dailyLimit: prev?.dailyLimit ?? 0,
                tariff: prev?.tariff ?? user?.tier ?? 'FREE',
                quotaMode: prev?.quotaMode,
                providerId: status.selectedProvider,
              }));
            })
            .catch(() => undefined)
        : Promise.resolve(),
    ]).catch((error) => {
      setState('error');
      setErrorMessage(apiErrorMessage(error));
    });
  }, [loadConversations, user?.tier, owner, isDev]);

  useEffect(() => {
    if (!activeId) return;
    listMessages(activeId)
      .then((items) => {
        setMessages(items);
        if (items.length > 0) setShowQuick(false);
        void loadFeedback(items);
      })
      .catch(() => {
        setErrorMessage(t('assistant.error.load'));
      });
  }, [activeId, loadFeedback, t]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function dispatchMessage(content: string) {
    setSending(true);
    setErrorMessage('');
    setRetryContent(null);
    setShowQuick(false);
    try {
      const result = await sendMessage(content, activeId ?? undefined);
      setActiveId(result.conversationId);
      setMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
      if (result.context?.ui) setContextUi(result.context.ui);
      const usageResult = await getAssistantUsage().catch(() => null);
      if (usageResult) {
        setUsage({
          requestCount: Number(usageResult.requestCount ?? 0),
          dailyLimit: Number(usageResult.dailyLimit ?? 0),
          tariff: String(usageResult.tariff ?? usage?.tariff ?? 'FREE'),
          quotaMode: typeof usageResult.quotaMode === 'string' ? usageResult.quotaMode : usage?.quotaMode,
          providerId:
            typeof result.providerId === 'string' && result.providerId !== 'policy'
              ? result.providerId
              : typeof usageResult.providerId === 'string'
                ? usageResult.providerId
                : usage?.providerId,
        });
      } else if (result.providerId && result.providerId !== 'policy') {
        setUsage((prev) => (prev ? { ...prev, providerId: result.providerId } : prev));
      }
      setInput('');
      setState('ready');
      if (!conversations.some((c) => c.id === result.conversationId)) {
        await loadConversations();
      }
    } catch {
      setErrorMessage(t('assistant.error.send'));
      setRetryContent(content);
    } finally {
      setSending(false);
    }
  }

  async function onSend(event?: React.FormEvent) {
    event?.preventDefault();
    if (!input.trim() || sending) return;
    await dispatchMessage(input.trim());
  }

  async function onQuickAction(text: string) {
    if (sending) return;
    setInput(text);
    await dispatchMessage(text);
  }

  async function onRetry() {
    if (!retryContent || sending) return;
    await dispatchMessage(retryContent);
  }

  async function onFeedback(messageId: string, rating: MessageFeedbackRating) {
    try {
      await submitMessageFeedback(messageId, rating);
      setFeedback((prev) => ({ ...prev, [messageId]: rating }));
    } catch {
      setErrorMessage(t('assistant.error.feedback'));
    }
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  }

  const tierBadge = usage?.tariff ?? user?.tier ?? 'FREE';
  const unlimited = usage?.quotaMode === 'UNLIMITED';
  const providerBadge = owner && isDev ? providerLabel(usage?.providerId) : null;

  if (state === 'loading') {
    return (
      <main className="wa-assistant" aria-busy="true" data-testid="assistant-screen">
        <h1 data-testid="assistant-heading">{t('assistant.title')}</h1>
        <p data-testid="assistant-loading" role="status" aria-live="polite">
          {t('common.loading')}
        </p>
      </main>
    );
  }

  return (
    <main className="wa-assistant" data-testid="assistant-screen">
      <div className="wa-assistant-shell">
        <header className="wa-assistant-header">
          <h1 data-testid="assistant-heading">{t('assistant.title')}</h1>
          <p className="wa-assistant-subtitle" data-testid="assistant-subtitle">
            {t('assistant.subtitle')}
          </p>

          <div className="wa-assistant-badges" data-testid="assistant-badges">
            {owner ? (
              <span className="wa-assistant-badge wa-assistant-badge--owner" data-testid="assistant-badge-role">
                OWNER
              </span>
            ) : null}
            <span className="wa-assistant-badge wa-assistant-badge--tier" data-testid="assistant-badge-tier">
              {tierBadge}
            </span>
            {usage ? (
              <span className="wa-assistant-badge" data-testid="assistant-usage">
                {unlimited
                  ? t('assistant.unlimited')
                  : t('assistant.usage', { used: usage.requestCount, limit: usage.dailyLimit })}
              </span>
            ) : null}
            {providerBadge ? (
              <span className="wa-assistant-badge wa-assistant-badge--muted" data-testid="assistant-provider-badge">
                {t('assistant.provider', { name: providerBadge })}
              </span>
            ) : null}
          </div>

          <ul className="wa-assistant-context" data-testid="assistant-context-usage" aria-label={t('assistant.contextLabel')}>
            <li className={contextUi?.profile ? 'is-on' : undefined} data-testid="context-profile">
              {contextUi?.profile ? '✓' : '○'} {t('assistant.context.profile')}
            </li>
            <li className={contextUi?.nutrition ? 'is-on' : undefined} data-testid="context-nutrition">
              {contextUi?.nutrition ? '✓' : '○'} {t('assistant.context.nutrition')}
            </li>
            <li className={contextUi?.progress ? 'is-on' : undefined} data-testid="context-progress">
              {contextUi?.progress ? '✓' : '○'} {t('assistant.context.progress')}
            </li>
            <li className={contextUi?.shopping ? 'is-on' : undefined} data-testid="context-shopping">
              {contextUi?.shopping ? '✓' : '○'} {t('assistant.context.shopping')}
            </li>
            <li className={contextUi?.prices ? 'is-on' : undefined} data-testid="context-prices">
              {contextUi?.prices ? '✓' : '○'} {t('assistant.context.prices')}
            </li>
          </ul>
        </header>

        <div className="wa-assistant-body">
          {conversations.length > 0 ? (
            <aside className="wa-assistant-conversations" data-testid="assistant-conversations">
              <ul>
                {conversations.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-testid={`conversation-${c.id}`}
                      onClick={() => setActiveId(c.id)}
                      aria-current={activeId === c.id ? 'true' : undefined}
                    >
                      {t('assistant.dialog')}
                      {c.createdAt ? ` · ${formatTime(c.createdAt, locale)}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}

          {showQuick && messages.length === 0 ? (
            <section className="wa-assistant-quick" data-testid="assistant-quick-actions" aria-label={t('assistant.quickLabel')}>
              <p className="wa-assistant-quick-title">{t('assistant.quickLabel')}</p>
              <div className="wa-assistant-chips">
                {quickActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="wa-assistant-chip"
                    data-testid={`assistant-quick-${action.id}`}
                    onClick={() => onQuickAction(action.text)}
                    disabled={sending}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {errorMessage ? (
            <div className="wa-assistant-error" role="alert" data-testid="assistant-error">
              <p>{errorMessage}</p>
              {retryContent ? (
                <button type="button" data-testid="assistant-retry" onClick={onRetry} disabled={sending}>
                  {t('assistant.retry')}
                </button>
              ) : null}
            </div>
          ) : null}

          <section className="wa-assistant-messages" aria-label={t('assistant.messagesLabel')} data-testid="assistant-messages">
            {messages.length === 0 ? (
              <p className="wa-assistant-empty" data-testid="assistant-empty">
                {t('assistant.empty')}
              </p>
            ) : null}

            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const display = localizeContentKeys(msg.content, tc);
              return (
                <article
                  key={msg.id}
                  className={`wa-assistant-row ${isUser ? 'wa-assistant-row--user' : 'wa-assistant-row--bot'}`}
                  data-testid={`message-${msg.role}-${msg.id}`}
                >
                  <div
                    aria-hidden="true"
                    className={`wa-assistant-avatar ${isUser ? 'wa-assistant-avatar--user' : 'wa-assistant-avatar--bot'}`}
                    data-testid={isUser ? 'message-avatar-user' : 'message-avatar-assistant'}
                  >
                    {isUser ? t('assistant.youShort') : 'AI'}
                  </div>
                  <div className="wa-assistant-bubble-wrap">
                    <header className="wa-assistant-meta">
                      <strong>{isUser ? t('assistant.you') : t('assistant.sender')}</strong>
                      <time data-testid={`message-time-${msg.id}`} dateTime={msg.createdAt}>
                        {formatTime(msg.createdAt, locale)}
                      </time>
                    </header>
                    <div className={`wa-assistant-bubble ${isUser ? 'wa-assistant-bubble--user' : 'wa-assistant-bubble--bot'}`}>
                      {isUser ? display : <AssistantRichText text={display} />}
                    </div>
                    {!isUser ? (
                      <div className="wa-assistant-feedback" data-testid={`message-feedback-${msg.id}`}>
                        <span>{t('assistant.feedback')}</span>
                        <button
                          type="button"
                          data-testid={`feedback-up-${msg.id}`}
                          aria-label={t('assistant.feedbackUp')}
                          onClick={() => onFeedback(msg.id, 'up')}
                          aria-pressed={feedback[msg.id] === 'up'}
                        >
                          👍
                        </button>
                        <button
                          type="button"
                          data-testid={`feedback-down-${msg.id}`}
                          aria-label={t('assistant.feedbackDown')}
                          onClick={() => onFeedback(msg.id, 'down')}
                          aria-pressed={feedback[msg.id] === 'down'}
                        >
                          👎
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {sending ? (
              <div
                className="wa-assistant-thinking"
                data-testid="assistant-thinking"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <div className="wa-assistant-avatar wa-assistant-avatar--bot" aria-hidden="true">
                  AI
                </div>
                <p style={{ margin: 0 }}>{t('assistant.thinking')}</p>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </section>

          <form className="wa-assistant-composer" onSubmit={onSend} data-testid="assistant-compose">
            <label htmlFor="assistant-input" className="sr-only">
              {t('assistant.inputLabel')}
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              data-testid="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={t('assistant.placeholder')}
              disabled={sending}
              rows={2}
            />
            <button type="submit" data-testid="assistant-send" disabled={sending || !input.trim()}>
              {sending ? t('assistant.sending') : t('assistant.send')}
            </button>
          </form>
        </div>
      </div>

      {messages.some((m) => m.role === 'assistant') ? (
        <p role="status" data-testid="assistant-status" className="sr-only">
          {t('assistant.replyReady')}
        </p>
      ) : null}
    </main>
  );
}
