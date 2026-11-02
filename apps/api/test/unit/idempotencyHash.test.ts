import { describe, expect, it } from 'vitest';
import { hashBody } from '../../src/services/idempotency';

describe('idempotency request hash', () => {
  it('ignores object key order', () => {
    expect(hashBody({ a: 1, b: { c: 2, d: 3 } })).toBe(hashBody({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes when any value changes', () => {
    expect(hashBody({ category: 'ECONOMY' })).not.toBe(hashBody({ category: 'COMFORT' }));
  });

  it('treats undefined fields as absent', () => {
    expect(hashBody({ a: 1, b: undefined })).toBe(hashBody({ a: 1 }));
  });
});
