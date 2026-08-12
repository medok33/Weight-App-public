import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { redisPingAndTouch } from '../application/redis-auth-abuse.service';

describe('RedisAuthAbuseService command acknowledgement', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('waits for the PING and SET acknowledgements instead of closing after a fixed delay', async () => {
    const server = createServer((socket) => {
      socket.once('data', () => {
        setTimeout(() => socket.end('+PONG\r\n+OK\r\n'), 35);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');

    await expect(redisPingAndTouch(`redis://127.0.0.1:${address.port}`, 'auth01b:abuse:register:test', 500)).resolves.toBeUndefined();
  });

  it('still rejects a Redis error reply', async () => {
    const server = createServer((socket) => socket.once('data', () => socket.end('-NOAUTH unavailable\r\n')));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');

    await expect(redisPingAndTouch(`redis://127.0.0.1:${address.port}`, 'auth01b:abuse:register:test', 500)).rejects.toThrow('REDIS_UNHEALTHY');
  });
});
