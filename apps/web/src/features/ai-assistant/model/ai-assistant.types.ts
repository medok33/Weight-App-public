export type AIControl = { enabled: boolean; updatedAt: string };

export type Conversation = {
  id: string;
  userId: string;
  title?: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type ContextUiLabels = {
  profile: boolean;
  nutrition: boolean;
  progress: boolean;
  shopping: boolean;
  prices: boolean;
};

export type ContextSnapshot = {
  userId: string;
  generatedAt: string;
  dataVersion: string;
  flags: Record<string, boolean>;
  ui: ContextUiLabels;
};

export type MessageFeedbackRating = 'up' | 'down';

export type SendMessageResult = {
  conversationId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  providerId: string;
  model: string;
  context?: {
    userId: string;
    generatedAt: string;
    dataVersion: string;
    ui: ContextUiLabels;
  };
};
