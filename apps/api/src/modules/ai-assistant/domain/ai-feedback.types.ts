export type MessageFeedbackRating = 'up' | 'down';

export type MessageFeedbackRecord = {
  id: string;
  userId: string;
  messageId: string;
  rating: MessageFeedbackRating;
  createdAt: string;
};

export type AIMetricsSummary = {
  requestCount: number;
  thumbsUp: number;
  thumbsDown: number;
  errorCount: number;
  popularTopics: Array<{ topic: string; count: number }>;
};
