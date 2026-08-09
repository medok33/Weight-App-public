import type { AdminMessageKey } from '../admin-message-keys';
import { adminRu } from './admin.ru';

/**
 * Admin chrome stays Russian even when the optional USER locale switch is `en`.
 * Weight App is a Russian product; admin must not reintroduce English labels.
 */
export const adminEn: Record<AdminMessageKey, string> = { ...adminRu };
