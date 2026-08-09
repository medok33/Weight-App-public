import { createConnection } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type ReadinessStatus = 'ok' | 'degraded' | 'not_ready';

export type ReadinessResult = {
  ready: boolean;
  status: ReadinessStatus;
  checks: {
    postgres: boolean;
    redis: boolean | 'optional';
    api: true;
  };
};

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async readiness(): Promise<ReadinessResult> {
    const postgres = await this.checkPostgres();
    const redisUp = await this.checkRedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const checks = {
      postgres,
      redis: redisUp as boolean | 'optional',
      api: true as const,
    };
    if (!postgres) {
      return { ready: false, status: 'not_ready', checks };
    }
    if (!redisUp) {
      return { ready: true, status: 'degraded', checks: { ...checks, redis: false } };
    }
    return { ready: true, status: 'ok', checks: { ...checks, redis: true } };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await Promise.race([
        this.db.query('SELECT 1'),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('PG_HEALTH_TIMEOUT')), 1000);
        }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private checkRedis(redisUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => done(false), 1000);
      try {
        const parsed = new URL(redisUrl);
        const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
        const socket = createConnection({ host, port: Number(parsed.port || 6379), family: 4 }, () => {
          socket.write('PING\r\n');
        });
        socket.on('data', (chunk) => {
          clearTimeout(timer);
          done(chunk.toString().includes('PONG'));
          socket.end();
        });
        socket.on('error', () => {
          clearTimeout(timer);
          done(false);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
  }
}
