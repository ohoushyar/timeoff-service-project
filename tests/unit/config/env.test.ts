import { describe, it, expect, afterEach } from 'vitest';
import { loadEnv, resetEnvCache, getEnv } from '../../../src/config/env.js';

describe('env config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('parses valid config with defaults', () => {
    const env = loadEnv({
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'secret',
      HCM_MOCK_MODE: 'false',
    });
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ISSUER).toBe('timeoff-service');
    expect(env.HCM_MOCK_MODE).toBe(false);
  });

  it('throws on missing required vars', () => {
    resetEnvCache();
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('applies HCM_MOCK_MODE true', () => {
    const env = loadEnv({
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'secret',
      HCM_MOCK_MODE: 'true',
    });
    expect(env.HCM_MOCK_MODE).toBe(true);
  });

  it('getEnv loads on first call', () => {
    loadEnv({ DATABASE_URL: 'file:./t.db', JWT_SECRET: 's' });
    expect(getEnv().JWT_SECRET).toBe('s');
  });
});
