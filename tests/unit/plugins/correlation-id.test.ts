import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { CorrelationIdMiddleware } from '../../../src/common/middleware/correlation-id.middleware.js';

@Controller()
class TestController {
  @Get('/test')
  test() {
    return { ok: true };
  }
}

@Module({
  controllers: [TestController],
})
class TestModule {}

describe('middleware/correlation-id', () => {
  let app: INestApplication;

  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.use(new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()));
    await nestApp.init();
    return nestApp;
  }

  it('echoes provided X-Correlation-Id header', async () => {
    app = await createApp();
    const res = await request(app.getHttpServer())
      .get('/test')
      .set('x-correlation-id', 'test-corr-123');

    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-corr-123');
    await app.close();
  });

  it('generates correlationId when header is missing', async () => {
    app = await createApp();
    const res = await request(app.getHttpServer()).get('/test');
    const responseCorrelationId = res.headers['x-correlation-id'];

    expect(typeof responseCorrelationId).toBe('string');
    expect((responseCorrelationId as string).length).toBeGreaterThan(0);
    await app.close();
  });
});
