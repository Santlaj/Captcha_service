import type { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface RateLimiterOptions {
  action: string;
  maxRequests: number;
  windowSeconds?: number;
}

export const RATE_LIMIT_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

/**
 * Creates an Express middleware that enforces Redis-backed rate limiting.
 * - Safely derives client IP using Express req.ip (honors trust proxy configuration).
 * - On limit exceeded: returns HTTP 429 with standard API error format and Retry-After header.
 * - On Redis failure in production: fails closed and returns HTTP 503 Service Unavailable with standard API format.
 * - On Redis failure in development/test: logs warning and permits request for offline developer experience.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { action, maxRequests, windowSeconds = 60 } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // In test environment, allow bypassing rate limits unless specifically testing rate limiter
    if (config.nodeEnv === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    // Determine client identifier safely via Express (reflects trust proxy settings)
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const currentWindow = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${action}:${clientIp}:${currentWindow}`;

    try {
      const result = await redisClient.eval(
        RATE_LIMIT_LUA,
        1,
        key,
        (windowSeconds + 5).toString(),
      );

      const requestCount = Number(result);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - requestCount));

      if (requestCount > maxRequests) {
        res.setHeader('Retry-After', windowSeconds);
        res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      next();
    } catch (error) {
      logger.error(`Rate limiter Redis failure for action '${action}':`, error);

      // In production, preserve fail-closed security: return 503 Service Unavailable
      if (config.nodeEnv === 'production') {
        res.setHeader('Retry-After', '30');
        res.status(503).json({
          success: false,
          error: 'Rate limiting service is temporarily unavailable. Please try again later.',
          code: 'RATE_LIMIT_UNAVAILABLE',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // In development / test, log warning and allow request through for offline DX
      logger.warn(`Rate limiting bypassed for '${action}' due to Redis connection issue in development mode`);
      next();
    }
  };
}
