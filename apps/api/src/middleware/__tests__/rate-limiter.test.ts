import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../rate-limiter.middleware.js';
import { redisClient } from '../../config/redis.js';

describe('RateLimiter Middleware', () => {
  it('allows requests when within the configured limit', async () => {
    const rateLimiter = createRateLimiter({
      action: 'test_action',
      maxRequests: 5,
      windowSeconds: 60,
    });

    const mockEval = vi.spyOn(redisClient, 'eval').mockResolvedValue(1); // 1st request

    const req = {
      ip: '192.168.1.1',
      headers: { 'x-test-rate-limit': 'true' },
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    await rateLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);

    mockEval.mockRestore();
  });

  it('blocks requests and returns HTTP 429 when limit is exceeded', async () => {
    const rateLimiter = createRateLimiter({
      action: 'test_action',
      maxRequests: 3,
      windowSeconds: 60,
    });

    const mockEval = vi.spyOn(redisClient, 'eval').mockResolvedValue(4); // 4th request exceeds limit of 3

    const req = {
      ip: '192.168.1.1',
      headers: { 'x-test-rate-limit': 'true' },
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    await rateLimiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
      }),
    );

    mockEval.mockRestore();
  });
});
