import Fastify from 'fastify';
import { WORKERS, LEAVE_TYPES, BALANCES } from './fixtures/index.js';

export interface MockScenario {
  simulateUnavailable?: boolean;
  simulateInsufficientBalance?: boolean;
}

const scenario: MockScenario = {};
let requestTimeOffCallCount = 0;
let correctTimeOffEntryCallCount = 0;

export function setMockScenario(s: MockScenario): void {
  scenario.simulateUnavailable = s.simulateUnavailable ?? false;
  scenario.simulateInsufficientBalance = s.simulateInsufficientBalance ?? false;
}

export function resetMockMetrics(): void {
  requestTimeOffCallCount = 0;
  correctTimeOffEntryCallCount = 0;
  scenario.simulateUnavailable = false;
  scenario.simulateInsufficientBalance = false;
}

export function getRequestTimeOffCallCount(): number {
  return requestTimeOffCallCount;
}

export function getCorrectTimeOffEntryCallCount(): number {
  return correctTimeOffEntryCallCount;
}

export function buildWorkdayMockApp() {
  const app = Fastify({ logger: false });

  app.post('/oauth2/token', async () => ({
    access_token: 'mock-access-token',
    token_type: 'Bearer',
    expires_in: 3600,
  }));

  app.get('/absenceManagement/v5/workers', async (request, reply) => {
    if (scenario.simulateUnavailable) {
      return reply.status(503).send({ error: 'Service unavailable' });
    }
    const query = request.query as { offset?: string; limit?: string };
    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 100);
    const slice = WORKERS.slice(offset, offset + limit);
    return { data: slice, total: WORKERS.length };
  });

  app.get('/absenceManagement/v5/balances', async (request, reply) => {
    if (scenario.simulateUnavailable) return reply503(reply);
    const query = request.query as { worker?: string };
    const worker = query.worker ?? '';
    const rows = BALANCES[worker] ?? [];
    return { data: rows, total: rows.length };
  });

  app.get('/absenceManagement/v5/workers/:id/eligibleAbsenceTypes', async (request, reply) => {
    if (scenario.simulateUnavailable) return reply503(reply);
    return { data: LEAVE_TYPES, total: LEAVE_TYPES.length };
  });

  app.post('/absenceManagement/v5/workers/:id/correctTimeOffEntry', async (request, reply) => {
    correctTimeOffEntryCallCount++;
    if (scenario.simulateUnavailable) return reply503(reply);
    return { status: 'ok' };
  });

  app.post('/absenceManagement/v5/workers/:id/requestTimeOff', async (request, reply) => {
    requestTimeOffCallCount++;
    if (scenario.simulateUnavailable) return reply503(reply);
    if (scenario.simulateInsufficientBalance) {
      return reply.status(422).send({
        error: 'Insufficient balance',
        errors: [{ code: 'A1011', error: 'Insufficient balance for worker' }],
      });
    }

    const body = request.body as { days?: Array<{ date?: string }> } | string;
    let days: Array<{ date?: string }> = [];
    if (typeof body === 'object' && body !== null && 'days' in body) {
      days = body.days ?? [];
    }

    const entryId = `entry-${Date.now()}`;
    return {
      days: days.map((d, i) => ({ date: d.date, id: `${entryId}-${i}` })),
    };
  });

  app.addContentTypeParser('*', (_req, payload, done) => {
    let data = '';
    payload.on('data', (chunk) => { data += chunk; });
    payload.on('end', () => {
      try {
        const jsonMatch = data.match(/\r\n\r\n(\{[\s\S]*?\})\r\n/);
        done(null, jsonMatch ? JSON.parse(jsonMatch[1]) : {});
      } catch {
        done(null, {});
      }
    });
  });

  return app;
}

function reply503(reply?: { status: (c: number) => { send: (b: unknown) => unknown } }) {
  if (reply) {
    return reply.status(503).send({ error: 'Service unavailable' });
  }
  throw new Error('Service unavailable');
}

export async function startWorkdayMock(port = 4001): Promise<ReturnType<typeof buildWorkdayMockApp>> {
  const app = buildWorkdayMockApp();
  await app.listen({ port, host: '127.0.0.1' });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkdayMock(Number(process.env.MOCK_PORT ?? 4001)).then((app) => {
    console.log(`Workday mock listening on ${app.server.address()}`);
  });
}
