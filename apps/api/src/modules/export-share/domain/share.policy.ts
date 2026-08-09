import type { ShareChannel, ShareLinkRecord } from './export-document.types';

const CHANNELS = new Set<ShareChannel>(['telegram', 'vk', 'whatsapp', 'email']);

export function validateShareChannel(channel: string): ShareChannel {
  if (!CHANNELS.has(channel as ShareChannel)) throw new Error('SHARE_CHANNEL_INVALID');
  return channel as ShareChannel;
}

export function assertShareLinkActive(link: ShareLinkRecord, nowMs = Date.now()): void {
  if (link.revokedAt) throw new Error('SHARE_LINK_REVOKED');
  if (Date.parse(link.expiresAt) <= nowMs) throw new Error('SHARE_LINK_EXPIRED');
}

export function validateShareTtlMinutes(ttlMinutes: number): number {
  if (!Number.isFinite(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 60 * 24 * 30) {
    throw new Error('SHARE_TTL_INVALID');
  }
  return Math.floor(ttlMinutes);
}

export function buildShareAdapterUrl(
  channel: ShareChannel,
  publicUrl: string,
  title: string,
): { channel: ShareChannel; url: string } {
  if (!/^https?:\/\//i.test(publicUrl)) throw new Error('SHARE_URL_INVALID');
  const encoded = encodeURIComponent(publicUrl);
  const text = encodeURIComponent(title);
  switch (channel) {
    case 'telegram':
      return { channel, url: `https://t.me/share/url?url=${encoded}&text=${text}` };
    case 'vk':
      return { channel, url: `https://vk.com/share.php?url=${encoded}` };
    case 'whatsapp':
      return { channel, url: `https://wa.me/?text=${text}%20${encoded}` };
    case 'email':
      return { channel, url: `mailto:?subject=${text}&body=${encoded}` };
    default:
      throw new Error('SHARE_CHANNEL_INVALID');
  }
}
