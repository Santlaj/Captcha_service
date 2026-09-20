import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import {
  generateRandomNumericAnswer,
  ChallengeService,
} from '../challenge.service.js';
import {
  InMemoryChallengeRepository,
  type IChallengeRepository,
} from '../../repositories/challenge.repository.js';
import { TokenService } from '../token.service.js';
import type { StoredChallenge } from '../../models/challenge.model.js';

describe('ChallengeService - Numeric CAPTCHA with Verification', () => {
  let memoryRepo: InMemoryChallengeRepository;
  let testTokenService: TokenService;
  let service: ChallengeService;

  beforeEach(() => {
    memoryRepo = new InMemoryChallengeRepository();
    testTokenService = new TokenService(
      'test_secret_key_at_least_32_characters_long_for_hs256',
      'HS256',
      300,
    );
    service = new ChallengeService(memoryRepo, testTokenService, 300, 5);
  });

  describe('Answer Generation (Prompt 1)', () => {
    it('generates an answer that is exactly six digits', () => {
      const answer = generateRandomNumericAnswer(6);
      expect(answer).toHaveLength(6);
    });

    it('generates an answer that contains only numeric characters', () => {
      for (let i = 0; i < 20; i++) {
        const answer = generateRandomNumericAnswer(6);
        expect(answer).toMatch(/^\d{6}$/);
      }
    });

    it('supports leading zeros without truncation', () => {
      const mockDigits = [0, 0, 7, 3, 1, 9];
      let callCount = 0;
      const mockRng = () => mockDigits[callCount++] ?? 0;

      const answer = generateRandomNumericAnswer(6, mockRng);
      expect(answer).toBe('007319');
      expect(answer).toHaveLength(6);
      expect(answer.startsWith('00')).toBe(true);
    });

    it('generates a non-empty PNG Buffer with valid PNG signature', async () => {
      const result = await service.generateNumericChallenge();

      expect(result).toBeDefined();
      expect(result.answer).toMatch(/^\d{6}$/);
      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
      expect(result.imageBuffer.length).toBeGreaterThan(0);

      const pngHeader = result.imageBuffer.subarray(0, 4);
      expect(pngHeader.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    });
  });

  describe('Challenge Creation & Storage (Prompt 2)', () => {
    it('generates a valid UUID challenge ID', async () => {
      const response = await service.createChallenge();
      expect(response.challengeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('generates unique challenge IDs for different challenges', async () => {
      const challenge1 = await service.createChallenge();
      const challenge2 = await service.createChallenge();
      expect(challenge1.challengeId).not.toBe(challenge2.challengeId);
    });

    it('stores the secret answer server-side and excludes it from the client response', async () => {
      const clientResponse = await service.createChallenge();
      const stored = await memoryRepo.findById(clientResponse.challengeId);

      expect(stored).not.toBeNull();
      expect(stored?.answer).toMatch(/^\d{6}$/);

      // Client response must strictly omit answer
      expect((clientResponse as Record<string, unknown>)['answer']).toBeUndefined();
      expect(Object.keys(clientResponse)).toEqual(['challengeId', 'image', 'expiresAt']);
    });
  });

  describe('CAPTCHA Verification & Token Issuance (Prompt 3)', () => {
    it('verifies a correct answer, invalidates challenge, and returns a valid signed token', async () => {
      const challenge = await service.createChallenge();
      const stored = await memoryRepo.findById(challenge.challengeId);
      const correctAnswer = stored!.answer;

      const result = await service.verifySolution(challenge.challengeId, correctAnswer);

      expect(result.success).toBe(true);
      expect(result.verificationToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // Verify claims on the issued token
      const claims = await testTokenService.verifyVerificationToken(result.verificationToken);
      expect(claims.sub).toBe(challenge.challengeId);
      expect(claims.type).toBe('captcha_verification');

      // Crucial: Challenge MUST be invalidated (single-use)
      const afterVerification = await memoryRepo.findById(challenge.challengeId);
      expect(afterVerification).toBeNull();
    });

    it('rejects an incorrect answer and reports remaining attempts without revealing answer', async () => {
      const challenge = await service.createChallenge();
      const wrongAnswer = '999999';

      await expect(service.verifySolution(challenge.challengeId, wrongAnswer)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Incorrect CAPTCHA answer',
        details: {
          code: 'INVALID_ANSWER',
          remainingAttempts: 4,
        },
      });

      // The challenge is still stored with attempt count = 1
      const stored = await memoryRepo.findById(challenge.challengeId);
      expect(stored).not.toBeNull();
      expect(stored?.attempts).toBe(1);
    });

    it('invalidates the challenge when maximum attempts (5) are reached', async () => {
      const challenge = await service.createChallenge();
      const wrongAnswer = '000000';

      // 4 failed attempts
      for (let i = 0; i < 4; i++) {
        await expect(service.verifySolution(challenge.challengeId, wrongAnswer)).rejects.toMatchObject({
          statusCode: 400,
        });
      }

      // 5th failed attempt exhausts the challenge
      await expect(service.verifySolution(challenge.challengeId, wrongAnswer)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Maximum verification attempts exceeded. Challenge has been invalidated.',
        details: {
          code: 'ATTEMPTS_EXCEEDED',
        },
      });

      // Challenge is now purged from repository
      const stored = await memoryRepo.findById(challenge.challengeId);
      expect(stored).toBeNull();
    });

    it('rejects a repeated verification attempt on an already-verified challenge', async () => {
      const challenge = await service.createChallenge();
      const stored = await memoryRepo.findById(challenge.challengeId);
      const correctAnswer = stored!.answer;

      // 1st verification succeeds
      const firstResult = await service.verifySolution(challenge.challengeId, correctAnswer);
      expect(firstResult.success).toBe(true);

      // 2nd verification must fail because challenge was consumed
      await expect(service.verifySolution(challenge.challengeId, correctAnswer)).rejects.toMatchObject({
        statusCode: 400,
        details: {
          code: 'CHALLENGE_EXPIRED_OR_NOT_FOUND',
        },
      });
    });

    it('handles missing or expired challenges gracefully', async () => {
      await expect(service.verifySolution('non-existent-uuid', '123456')).rejects.toMatchObject({
        statusCode: 400,
        details: {
          code: 'CHALLENGE_EXPIRED_OR_NOT_FOUND',
        },
      });
    });

    it('prevents concurrent requests from successfully verifying the same challenge multiple times', async () => {
      const challenge = await service.createChallenge();
      const stored = await memoryRepo.findById(challenge.challengeId);
      const correctAnswer = stored!.answer;

      // Fire 5 simultaneous verification requests
      const promises = [
        service.verifySolution(challenge.challengeId, correctAnswer),
        service.verifySolution(challenge.challengeId, correctAnswer),
        service.verifySolution(challenge.challengeId, correctAnswer),
        service.verifySolution(challenge.challengeId, correctAnswer),
        service.verifySolution(challenge.challengeId, correctAnswer),
      ];

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE request must succeed!
      expect(fulfilled).toHaveLength(1);
      // All other 4 requests must fail
      expect(rejected).toHaveLength(4);
    });

    it('fails gracefully without returning fake success when Redis fails', async () => {
      const failingRepo: IChallengeRepository = {
        save: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        findById: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        delete: vi.fn(),
        verifyAndConsume: vi.fn().mockRejectedValue(new Error('Redis connection error')),
      };

      const failingService = new ChallengeService(failingRepo, testTokenService, 300, 5);

      await expect(failingService.verifySolution('any-id', '123456')).rejects.toThrow(
        'Redis connection error',
      );
    });

    it('preserves challenge and attempt count intact if token signing fails (Prompt 4 Safe Flow)', async () => {
      const challenge = await service.createChallenge();
      const stored = await memoryRepo.findById(challenge.challengeId);
      const correctAnswer = stored!.answer;

      // Spy and simulate JWT signing failure (e.g., crypto error or key rotation fault)
      const signSpy = vi
        .spyOn(testTokenService, 'createVerificationToken')
        .mockRejectedValueOnce(new Error('Crypto subsystem failure: signing key unavailable'));

      // verifySolution should fail due to token signing
      await expect(service.verifySolution(challenge.challengeId, correctAnswer)).rejects.toThrow(
        'Crypto subsystem failure: signing key unavailable',
      );

      // Verify that the challenge was NOT consumed or corrupted in the repository!
      const afterFailedSigning = await memoryRepo.findById(challenge.challengeId);
      expect(afterFailedSigning).not.toBeNull();
      expect(afterFailedSigning?.attempts).toBe(0);

      // When the token service recovers, the user can successfully verify without losing the challenge
      signSpy.mockRestore();
      const retryResult = await service.verifySolution(challenge.challengeId, correctAnswer);
      expect(retryResult.success).toBe(true);
      expect(retryResult.verificationToken).toBeDefined();

      // Now it is consumed
      const afterSuccess = await memoryRepo.findById(challenge.challengeId);
      expect(afterSuccess).toBeNull();
    });

    it('retries challenge creation on challenge ID collision (Prompt 6 Collision Handling)', async () => {
      let callCount = 0;
      const collisionRepo: IChallengeRepository = {
        save: vi.fn().mockImplementation(async () => {
          callCount++;
          // First attempt collides (returns false), second succeeds (returns true)
          return callCount > 1;
        }),
        findById: vi.fn(),
        delete: vi.fn(),
        verifyAndConsume: vi.fn(),
      };

      const retryService = new ChallengeService(collisionRepo, testTokenService, 300, 5);
      const challenge = await retryService.createChallenge();

      expect(challenge.challengeId).toBeDefined();
      expect(callCount).toBe(2);
      expect(collisionRepo.save).toHaveBeenCalledTimes(2);
    });

    it('throws when challenge ID collision persists past max retries', async () => {
      const collisionRepo: IChallengeRepository = {
        save: vi.fn().mockResolvedValue(false), // always collides
        findById: vi.fn(),
        delete: vi.fn(),
        verifyAndConsume: vi.fn(),
      };

      const retryService = new ChallengeService(collisionRepo, testTokenService, 300, 5);
      await expect(retryService.createChallenge()).rejects.toThrow(
        'Failed to generate a unique challenge ID. Please try again.',
      );
    });
  });
});
