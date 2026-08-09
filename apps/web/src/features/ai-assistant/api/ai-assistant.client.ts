import { apiFetch, ApiError } from '@/lib/api-fetch';
import type { ChatMessage, ContextSnapshot, Conversation, MessageFeedbackRating, SendMessageResult } from '../model/ai-assistant.types';

export async function getAIControl() {
  const r = await fetch('/api/ai-assistant/owner-control', { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new ApiError(r.status);
  return r.json() as Promise<{ enabled: boolean; updatedAt: string }>;
}

export async function setAIControl(enabled: boolean) {
  const r = await fetch('/api/ai-assistant/owner-control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled }),
  });
  if (!r.ok) throw new ApiError(r.status);
  return r.json() as Promise<{ enabled: boolean; updatedAt: string }>;
}

export async function getAssistantContext(): Promise<ContextSnapshot> {
  const response = await apiFetch('/assistant/context');
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ContextSnapshot>;
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await apiFetch('/assistant/conversations');
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<Conversation[]>;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const response = await apiFetch(`/assistant/conversations/${conversationId}/messages`);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<ChatMessage[]>;
}

export async function sendMessage(content: string, conversationId?: string): Promise<SendMessageResult> {
  const url = conversationId
    ? `/assistant/conversations/${conversationId}/messages`
    : '/assistant/messages';
  const response = await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<SendMessageResult>;
}

export async function getAssistantUsage() {
  const response = await apiFetch('/assistant/usage');
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export async function getAssistantProviderStatus(): Promise<{
  selectedProvider?: string;
  configured?: boolean;
  apiKey?: string;
} | null> {
  const response = await apiFetch('/assistant/provider-status');
  if (!response.ok) return null;
  return response.json();
}

export async function submitMessageFeedback(messageId: string, rating: MessageFeedbackRating) {
  const response = await apiFetch(`/assistant/messages/${messageId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export async function listMessageFeedback(messageIds: string[]): Promise<Record<string, MessageFeedbackRating>> {
  const response = await apiFetch('/assistant/feedback/batch', {
    method: 'POST',
    body: JSON.stringify({ messageIds }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<Record<string, MessageFeedbackRating>>;
}
