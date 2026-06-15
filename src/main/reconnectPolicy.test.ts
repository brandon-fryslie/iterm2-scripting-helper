import { describe, it, expect } from 'vitest';
import { reconnectDelay, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './reconnectPolicy';

describe('reconnectDelay backoff schedule', () => {
  it('starts at the base delay for the first attempt', () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_BASE_MS);
  });

  it('doubles each attempt until it reaches the cap', () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelay)).toEqual([250, 500, 1000, 2000, 4000]);
  });

  it('caps the delay so polling never grows unbounded', () => {
    expect(reconnectDelay(5)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelay(50)).toBe(RECONNECT_MAX_MS);
  });

  it('is monotonically non-decreasing', () => {
    const delays = Array.from({ length: 12 }, (_, i) => reconnectDelay(i));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});
