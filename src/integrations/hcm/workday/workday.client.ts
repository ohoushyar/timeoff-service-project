import type { Env } from '../../../config/env.js';
import { HcmUnavailableError, HcmValidationError } from '../types.js';
import { parseWorkdayError } from './error-mapping.js';

export interface WorkdayClientOptions {
  env: Env;
  fetchFn?: typeof fetch;
}

export class WorkdayHttpClient {
  private accessToken: string | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: WorkdayClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get baseUrl(): string {
    const host = this.opts.env.WORKDAY_TENANT_HOSTNAME ?? 'localhost:4001';
    const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  async getAccessToken(): Promise<string> {
    if (this.opts.env.HCM_MOCK_MODE) {
      this.accessToken = 'mock-access-token';
      return this.accessToken;
    }
    if (this.accessToken) return this.accessToken;

    const res = await this.fetchFn(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.opts.env.WORKDAY_REFRESH_TOKEN ?? '',
        client_id: this.opts.env.WORKDAY_CLIENT_ID ?? '',
        client_secret: this.opts.env.WORKDAY_CLIENT_SECRET ?? '',
      }),
    });
    if (!res.ok) throw new HcmUnavailableError('OAuth token refresh failed');
    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  async request<T>(
    path: string,
    options: RequestInit & { retries?: number } = {},
  ): Promise<T> {
    const maxRetries = options.retries ?? 5;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      try {
        const token = await this.getAccessToken();
        const res = await this.fetchFn(`${this.baseUrl}${path}`, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(options.headers ?? {}),
          },
        });

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') ?? '1');
          await sleep(retryAfter * 1000);
          attempt++;
          continue;
        }

        if (res.status >= 500) {
          await sleep(Math.pow(2, attempt) * 100);
          attempt++;
          lastError = new HcmUnavailableError(`Workday ${res.status}`);
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          throw new HcmUnavailableError(`Workday auth error ${res.status}`);
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const parsed = parseWorkdayError(body);
          throw new HcmValidationError(parsed.code, parsed.message);
        }

        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof HcmValidationError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= maxRetries - 1) break;
        await sleep(Math.pow(2, attempt) * 100);
        attempt++;
      }
    }
    throw lastError ?? new HcmUnavailableError();
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async postMultipart(path: string, jsonData: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const boundary = `----WorkdayBoundary${Date.now()}`;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="jsonData"',
      'Content-Type: application/json',
      '',
      JSON.stringify(jsonData),
      `--${boundary}--`,
    ].join('\r\n');

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (res.status >= 500 || res.status === 503) {
      throw new HcmUnavailableError(`Workday ${res.status}`);
    }
    if (!res.ok) {
      const parsed = parseWorkdayError(await res.json().catch(() => ({})));
      throw new HcmValidationError(parsed.code, parsed.message);
    }
    return res.json();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
