import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import correlationIdPlugin from '../../../src/plugins/correlation-id.js';

describe('plugins/correlation-id', () => {
  const apps: Array<Awaited<ReturnType<typeof Fastify>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('binds correlationId to request logs', async () => {
    const logs: Record<string, unknown>[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: {
          write(msg: string) {
            logs.push(JSON.parse(msg));
          },
        },
      },
    });
    apps.push(app);

    await app.register(correlationIdPlugin);
    app.get('/test', async (request) => {
      request.log.info('handled');
      return { ok: true };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-correlation-id': 'test-corr-123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-corr-123');

    const handledLog = logs.find((entry) => entry.msg === 'handled');
    expect(handledLog?.correlationId).toBe('test-corr-123');

    const completedLog = logs.find((entry) => entry.msg === 'request completed');
    expect(completedLog?.correlationId).toBe('test-corr-123');

    const incomingLog = logs.find((entry) => entry.msg === 'incoming request');
    expect(incomingLog?.correlationId).toBe('test-corr-123');
  });

  it('generates correlationId when header is missing', async () => {
    const logs: Record<string, unknown>[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: {
          write(msg: string) {
            logs.push(JSON.parse(msg));
          },
        },
      },
    });
    apps.push(app);

    await app.register(correlationIdPlugin);
    app.get('/test', async (request) => {
      request.log.info('handled');
      return { ok: true };
    });

    const res = await app.inject({ method: 'GET', url: '/test' });
    const responseCorrelationId = res.headers['x-correlation-id'];

    expect(typeof responseCorrelationId).toBe('string');
    expect((responseCorrelationId as string).length).toBeGreaterThan(0);

    const handledLog = logs.find((entry) => entry.msg === 'handled');
    expect(handledLog?.correlationId).toBe(responseCorrelationId);
  });
});
