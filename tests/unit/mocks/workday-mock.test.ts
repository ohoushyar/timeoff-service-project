import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildWorkdayMockApp,
  setMockScenario,
} from '../../../tools/workday-mock/server';

describe('workday mock server', () => {
  let app: ReturnType<typeof buildWorkdayMockApp>;

  beforeAll(async () => {
    app = buildWorkdayMockApp();
    await app.ready();
  });

  afterAll(async () => {
    setMockScenario({});
    await app.close();
  });

  it('returns paginated workers', async () => {
    const res = await app.inject({ method: 'GET', url: '/absenceManagement/v5/workers?limit=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.total).toBeGreaterThan(0);
  });

  it('returns balances for worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/absenceManagement/v5/balances?worker=worker-alice-wid',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('simulateUnavailable returns 503', async () => {
    setMockScenario({ simulateUnavailable: true });
    const res = await app.inject({ method: 'GET', url: '/absenceManagement/v5/workers' });
    expect(res.statusCode).toBe(503);
    setMockScenario({});
  });

  it('simulateInsufficientBalance on requestTimeOff', async () => {
    setMockScenario({ simulateInsufficientBalance: true });
    const res = await app.inject({
      method: 'POST',
      url: '/absenceManagement/v5/workers/worker-alice-wid/requestTimeOff',
      payload: { days: [{ date: '2026-07-10' }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('A1011');
    setMockScenario({});
  });

  it('oauth token stub', async () => {
    const res = await app.inject({ method: 'POST', url: '/oauth2/token' });
    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBeDefined();
  });
});
