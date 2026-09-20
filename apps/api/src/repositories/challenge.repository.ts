import type { Redis } from 'ioredis';
import { redisClient } from '../config/redis.js';
import type { StoredChallenge, VerificationResult } from '../models/challenge.model.js';
import { logger } from '../utils/logger.js';

/**
 * Interface defining storage operations for active CAPTCHA challenges.
 * Isolates all Redis operations from the service and controller layers.
 */
export interface IChallengeRepository {
  /**
   * Atomically stores a challenge with TTL only if the ID does not already exist (NX).
   * Returns true if successfully stored, or false if a key collision occurred.
   */
  save(challenge: StoredChallenge, ttlSeconds: number): Promise<boolean>;
  findById(id: string): Promise<StoredChallenge | null>;
  delete(id: string): Promise<void>;
  verifyAndConsume(id: string, answer: string, maxAttempts: number): Promise<VerificationResult>;
  /**
   * Atomically registers a verification token JTI as redeemed.
   * Returns true if successfully redeemed for the first time, or false if already redeemed (replay).
   */
  markTokenRedeemed(jti: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Atomic Lua script for validating solutions.
 * Guarantees race-condition prevention across concurrent requests:
 * 1. Checks if challenge exists (returns -1 if expired or missing).
 * 2. If attempts >= maxAttempts, invalidates and returns -2 (exhausted).
 * 3. Compares answer:
 *    - On match: atomically deletes challenge (single-use) and returns 1 (success).
 *    - On mismatch: increments attempts, preserves remaining TTL. If limit reached, deletes and returns -2.
 */
const VERIFY_LUA_SCRIPT = `
local data = redis.call("GET", KEYS[1])
if not data then
    return -1
end

local challenge = cjson.decode(data)
local attempts = tonumber(challenge.attempts) or 0
local maxAttempts = tonumber(ARGV[2]) or 5

if attempts >= maxAttempts then
    redis.call("DEL", KEYS[1])
    return -2
end

if tostring(challenge.answer) == tostring(ARGV[1]) then
    redis.call("DEL", KEYS[1])
    return "SUCCESS"
else
    attempts = attempts + 1
    challenge.attempts = attempts

    if attempts >= maxAttempts then
        redis.call("DEL", KEYS[1])
        return -2
    else
        local remainingTtl = redis.call("TTL", KEYS[1])
        if remainingTtl > 0 then
            redis.call("SET", KEYS[1], cjson.encode(challenge), "EX", remainingTtl)
            return attempts
        else
            redis.call("DEL", KEYS[1])
            return -1
        end
    end
end
`;

/**
 * Redis implementation of IChallengeRepository.
 * Uses atomic Redis SET with EX and NX options, and atomic Lua verification.
 * Never silently falls back to in-memory in production.
 */
export class RedisChallengeRepository implements IChallengeRepository {
  constructor(
    private readonly redis: Redis = redisClient,
    private readonly keyPrefix: string = 'captcha:challenge:',
  ) {}

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }


  /**
   * Atomically saves the challenge in Redis with TTL and NX (Not eXists).
   * Returns true on success, or false if a collision occurred.
   */
  async save(challenge: StoredChallenge, ttlSeconds: number): Promise<boolean> {
    const key = this.getKey(challenge.id);
    const serializedData = JSON.stringify(challenge);

    try {
      const result = await this.redis.set(key, serializedData, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error(`Failed to store challenge ${challenge.id} in Redis:`, error);
      throw error;
    }
  }

  async findById(id: string): Promise<StoredChallenge | null> {
    const key = this.getKey(id);

    try {
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }

      return JSON.parse(data) as StoredChallenge;
    } catch (error) {
      logger.error(`Failed to fetch challenge ${id} from Redis:`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);

    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error(`Failed to delete challenge ${id} from Redis:`, error);
      throw error;
    }
  }

  /**
   * Atomically verifies the answer using Lua script on Redis.
   * Prevents concurrent race conditions from verifying the same challenge multiple times.
   */
  async verifyAndConsume(id: string, answer: string, maxAttempts: number): Promise<VerificationResult> {
    const key = this.getKey(id);

    try {
      const result = await this.redis.eval(
        VERIFY_LUA_SCRIPT,
        1,
        key,
        answer,
        maxAttempts.toString(),
      );

      if (result === 'SUCCESS') {
        return { status: 'SUCCESS' };
      }

      const code = Number(result);

      if (code === -1) {
        return { status: 'NOT_FOUND' };
      }

      if (code === -2) {
        return { status: 'EXHAUSTED', remainingAttempts: 0 };
      }

      // Positive integer indicates number of failed attempts made so far
      const remainingAttempts = Math.max(0, maxAttempts - code);
      return { status: 'INCORRECT', remainingAttempts };
    } catch (error) {
      logger.error(`Failed to execute atomic verification for ${id} in Redis:`, error);
      throw error;
    }
  }

  async markTokenRedeemed(jti: string, ttlSeconds: number): Promise<boolean> {
    const key = `captcha:redeemed:${jti}`;
    try {
      const result = await this.redis.set(key, '1', 'EX', Math.max(1, ttlSeconds), 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error(`Failed to mark token ${jti} redeemed in Redis:`, error);
      throw error;
    }
  }
}

/**
 * In-memory implementation of IChallengeRepository.
 * Fully emulates atomic verification, collision checks (NX), and attempt limits for isolated testing.
 */
export class InMemoryChallengeRepository implements IChallengeRepository {
  private readonly storage = new Map<string, { challenge: StoredChallenge; expiresAtMs: number }>();
  private readonly redeemedTokens = new Map<string, number>();

  async save(challenge: StoredChallenge, ttlSeconds: number): Promise<boolean> {
    if (this.storage.has(challenge.id)) {
      const existing = this.storage.get(challenge.id)!;
      // If unexpired collision, return false
      if (Date.now() <= existing.expiresAtMs) {
        return false;
      }
    }

    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    this.storage.set(challenge.id, {
      challenge: { ...challenge, attempts: challenge.attempts || 0 },
      expiresAtMs,
    });
    return true;
  }

  async findById(id: string): Promise<StoredChallenge | null> {
    const item = this.storage.get(id);
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiresAtMs) {
      this.storage.delete(id);
      return null;
    }

    return { ...item.challenge };
  }

  async delete(id: string): Promise<void> {
    this.storage.delete(id);
  }

  async verifyAndConsume(id: string, answer: string, maxAttempts: number): Promise<VerificationResult> {
    const item = this.storage.get(id);
    if (!item) {
      return { status: 'NOT_FOUND' };
    }

    if (Date.now() > item.expiresAtMs) {
      this.storage.delete(id);
      return { status: 'NOT_FOUND' };
    }

    const { challenge } = item;

    if (challenge.attempts >= maxAttempts) {
      this.storage.delete(id);
      return { status: 'EXHAUSTED', remainingAttempts: 0 };
    }

    if (String(challenge.answer).trim() === String(answer).trim()) {
      // Invalidate immediately on success
      this.storage.delete(id);
      return { status: 'SUCCESS' };
    }

    // Mismatch
    challenge.attempts += 1;

    if (challenge.attempts >= maxAttempts) {
      this.storage.delete(id);
      return { status: 'EXHAUSTED', remainingAttempts: 0 };
    }

    const remainingAttempts = maxAttempts - challenge.attempts;
    return { status: 'INCORRECT', remainingAttempts };
  }

  async markTokenRedeemed(jti: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const existingExpiry = this.redeemedTokens.get(jti);
    if (existingExpiry && now < existingExpiry) {
      return false; // Already redeemed
    }
    this.redeemedTokens.set(jti, now + Math.max(1, ttlSeconds) * 1000);
    return true;
  }

  clear(): void {
    this.storage.clear();
    this.redeemedTokens.clear();
  }
}

// Default export uses Redis. Production code never falls back to in-memory.
export const challengeRepository: IChallengeRepository = new RedisChallengeRepository();
