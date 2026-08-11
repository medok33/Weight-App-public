import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';
import {
  AuthAbuseGuardUnavailableError,
  type AuthHighRiskAction,
  redisAuthAbuseKey,
} from '../domain/auth-abuse.policy';

const DEFAULT_TIMEOUT_MS = 750;

@Injectable()
export class RedisAuthAbuseService {
  async assertAvailableFor(action: AuthHighRiskAction, subjectHash: string): Promise<void> {
    const url = process.env.AUTH_ABUSE_REDIS_URL ?? process.env.REDIS_URL;
    const requireRedis = String(process.env.AUTH_ABUSE_REDIS_REQUIRED ?? '').toLowerCase() === 'true';
    if (!url) {
      if (requireRedis) throw new AuthAbuseGuardUnavailableError();
      return;
    }
    try {
      const key = redisAuthAbuseKey(action, subjectHash);
      await redisPingAndTouch(url, key, DEFAULT_TIMEOUT_MS);
    } catch (error) {
      const safe = error instanceof Error ? { errorClass: error.constructor.name, errorCode: typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : error.message } : { errorClass: 'UNKNOWN', errorCode: null };
      console.warn(JSON.stringify({ event: 'auth.abuse.redis.unavailable', operation: 'PING_AND_SET', ...safe }));
      throw new AuthAbuseGuardUnavailableError();
    }
  }
}

export async function redisPingAndTouch(urlText: string, key: string, timeoutMs: number): Promise<void> {
  const parsed = new URL(urlText);
  const host = parsed.hostname || '127.0.0.1';
  const port = parsed.port ? Number(parsed.port) : 6379;
  const password = parsed.password ? decodeURIComponent(parsed.password) : '';
  const socket = new Socket();
  socket.setTimeout(timeoutMs);
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const fail = (error: Error) => reject(error);
      socket.once('error', fail);
      socket.once('timeout', () => fail(new Error('REDIS_TIMEOUT')));
      socket.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const received = Buffer.concat(chunks).toString('utf8');
        if (received.includes('-ERR') || received.includes('-NOAUTH')) fail(new Error('REDIS_UNHEALTHY'));
        if (received.includes('+PONG') && received.includes('+OK')) resolve(received);
      });
      socket.connect(port, host, () => {
        const commands = [
          ...(password ? [resp(['AUTH', password])] : []),
          resp(['PING']),
          resp(['SET', key, String(Date.now()), 'EX', '60']),
        ].join('');
        socket.write(commands, (error) => { if (error) fail(error); });
      });
    });
    if (!response.includes('+PONG') || !response.includes('+OK')) throw new Error('REDIS_UNHEALTHY');
  } finally {
    socket.end();
  }
}

function resp(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}
