import { describe, it, expect } from 'vitest';
import { redactPii } from '../../../src/services/audit.service';

describe('audit.service', () => {
  it('strips email from snapshots', () => {
    const result = redactPii({
      id: '1',
      email: 'secret@example.com',
      department: 'Eng',
    }) as Record<string, unknown>;
    expect(result.email).toBeUndefined();
    expect(result.department).toBe('Eng');
  });

  it('redacts nested email', () => {
    const result = redactPii({ employee: { email: 'a@b.com', name: 'X' } }) as {
      employee: Record<string, unknown>;
    };
    expect(result.employee.email).toBeUndefined();
  });
});
