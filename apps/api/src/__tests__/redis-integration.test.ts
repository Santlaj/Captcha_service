import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  RedisChallengeRepository,
  type VerificationResult,
} from '../repositories/challenge.repository.js';
import { ChallengeService } from '../services/challenge.service.js';
import { TokenService } from '../services/token.service.js';
import { RATE_LIMIT_LUA } from '../middleware/rate-limiter.middleware.js';
import type { StoredChallenge } from '../models/challenge.model.js';

describe('Real Redis Integration Tests (Prompt 8 Isolated & Safe)', () => {
  let redis: Redis;
  let redisRepo: RedisChallengeRepository;
  let tokenService: TokenService;
  let challengeService: ChallengeService;
  let isRedisAvailable = false;
  const createdKeys: string[] = [];
  const TEST_PREFIX = 'test:captcha:challenge:';

  beforeAll(async () => {
    const redisUrl = process.env['REDIS_URL'] || 'redis://127.0.0.1:6379';
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      await redis.ping();
      isRedisAvailable = true;
      // Use isolated test key prefix to guarantee no production or staging keys are touched
      redisRepo = new RedisChallengeRepository(redis, TEST_PREFIX);
      tokenService = new TokenService(
        'test_secret_key_at_least_32_characters_long_for_hs256',
        'HS256',
        300,
      );
      challengeService = new ChallengeService(redisRepo, tokenService, 300, 5);
    } catch (err) {
      console.warn(
        `\n[WARNING] Real Redis instance is not reachable at ${redisUrl}. Live Redis integration tests will be marked as SKIPPED.\n` +
          'To run these tests, start Redis: docker compose -f infra/docker-compose.yml up -d redis\n',
      );
      isRedisAvailable = false;
    }
  });

  afterEach(async () => {
    // Guarantees test key cleanup runs even if assertions inside tests fail
    if (isRedisAvailable && redis && createdKeys.length > 0) {
      const keysToDelete = [...createdKeys];
      createdKeys.length = 0;
      try {
        await redis.del(...keysToDelete);
      } catch {
        // ignore cleanup errors during teardown
      }
    }
  });

  afterAll(async () => {
    if (isRedisAvailable && redis) {
      try {
        if (createdKeys.length > 0) {
          await redis.del(...createdKeys);
        }
      } finally {
        await redis.quit().catch(() => {});
      }
    }
  });

  function createTestChallenge(overrides: Partial<StoredChallenge> = {}): StoredChallenge {
    const id = randomUUID();
    const now = new Date();
    // Track key for guaranteed teardown cleanup
    createdKeys.push(`${TEST_PREFIX}${id}`);
    return {
      id,
      answer: '428190',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300000).toISOString(),
      attempts: 0,
      maxAttempts: 5,
      ...overrides,
    };
  }

  it.skipIf(!isRedisAvailable)('Concurrent correct submissions: exactly one successful verification', async () => {
    const challenge = createTestChallenge();
    const saved = await redisRepo.save(challenge, 300);
    expect(saved).toBe(true);

    // Launch 10 simultaneous verification requests with the correct answer
    const concurrency = 10;
    const verificationPromises: Promise<VerificationResult>[] = [];

    for (let i = 0; i < concurrency; i++) {
      verificationPromises.push(
        redisRepo.verifyAndConsume(challenge.id, challenge.answer, challenge.maxAttempts),
      );
    }

    const results = await Promise.all(verificationPromises);

    const successful = results.filter((r) => r.status === 'SUCCESS');
    const notFound = results.filter((r) => r.status === 'NOT_FOUND');

    // Exactly one request must succeed
    expect(successful).toHaveLength(1);
    // All remaining 9 requests must find nothing (challenge was consumed atomically)
    expect(notFound).toHaveLength(concurrency - 1);

    // Challenge must be completely purged from Redis
    const afterCheck = await redisRepo.findById(challenge.id);
    expect(afterCheck).toBeNull();
  });

  it.skipIf(!isRedisAvailable)('Concurrent incorrect submissions: attempt limits cannot be bypassed', async () => {
    const maxAttempts = 3;
    const challenge = createTestChallenge({ maxAttempts });
    await redisRepo.save(challenge, 300);

    // Launch 8 simultaneous incorrect verification attempts (exceeding maxAttempts of 3)
    const attempts = 8;
    const promises: Promise<VerificationResult>[] = [];

    for (let i = 0; i < attempts; i++) {
      promises.push(
        redisRepo.verifyAndConsume(challenge.id, '000000', maxAttempts),
      );
    }

    const results = await Promise.all(promises);

    const incorrectResults = results.filter((r) => r.status === 'INCORRECT');
    const exhaustedResults = results.filter((r) => r.status === 'EXHAUSTED');
    const notFoundResults = results.filter((r) => r.status === 'NOT_FOUND');

    // Total attempts processed before deletion cannot exceed maxAttempts
    expect(incorrectResults.length).toBe(maxAttempts - 1); // 2
    expect(exhaustedResults.length).toBe(1); // 1
    expect(notFoundResults.length).toBe(attempts - maxAttempts); // 5

    // Key must be deleted from Redis
    const afterCheck = await redisRepo.findById(challenge.id);
    expect(afterCheck).toBeNull();
  });

  it.skipIf(!isRedisAvailable)('Challenge expiration and automatic deletion via Redis TTL', async () => {
    const challenge = createTestChallenge();
    // Save with 1 second TTL
    await redisRepo.save(challenge, 1);

    // Verify key exists and TTL is set in Redis
    const rawKey = `${TEST_PREFIX}${challenge.id}`;
    const ttl = await redis.ttl(rawKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1);

    const immediate = await redisRepo.findById(challenge.id);
    expect(immediate).not.toBeNull();
    expect(immediate?.id).toBe(challenge.id);

    // Wait 1.2 seconds for Redis TTL eviction
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const expired = await redisRepo.findById(challenge.id);
    expect(expired).toBeNull();
  });

  it.skipIf(!isRedisAvailable)('Explicit challenge deletion', async () => {
    const challenge = createTestChallenge();
    await redisRepo.save(challenge, 300);

    const before = await redisRepo.findById(challenge.id);
    expect(before).not.toBeNull();

    await redisRepo.delete(challenge.id);

    const after = await redisRepo.findById(challenge.id);
    expect(after).toBeNull();
  });

  it('Propagates Redis errors cleanly instead of silent fallback', async () => {
    // Construct repository with invalid host to trigger connection failure
    const deadRedis = new Redis({
      host: '127.0.0.1',
      port: 65530, // Unused port
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      retryStrategy: () => null,
      lazyConnect: true,
    });

    const deadRepo = new RedisChallengeRepository(deadRedis, 'test:dead:');
    const testChallenge = createTestChallenge();

    await expect(deadRepo.save(testChallenge, 60)).rejects.toThrow();
    await expect(deadRepo.findById(testChallenge.id)).rejects.toThrow();
    await expect(deadRepo.verifyAndConsume(testChallenge.id, '123456', 5)).rejects.toThrow();

    await deadRedis.disconnect();
  });

  it.skipIf(!isRedisAvailable)('Rate-limit Lua counter increments and sets TTL correctly in Redis', async () => {
    const testRateKey = `ratelimit:test:${randomUUID()}`;
    createdKeys.push(testRateKey);
    const windowSeconds = 10;

    // 1st request
    const count1 = await redis.eval(RATE_LIMIT_LUA, 1, testRateKey, (windowSeconds + 5).toString());
    expect(Number(count1)).toBe(1);

    // Verify TTL was set on the key by the Lua script
    const ttl = await redis.ttl(testRateKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(windowSeconds + 5);

    // 2nd request
    const count2 = await redis.eval(RATE_LIMIT_LUA, 1, testRateKey, (windowSeconds + 5).toString());
    expect(Number(count2)).toBe(2);

    // 3rd request
    const count3 = await redis.eval(RATE_LIMIT_LUA, 1, testRateKey, (windowSeconds + 5).toString());
    expect(Number(count3)).toBe(3);
  });
});
