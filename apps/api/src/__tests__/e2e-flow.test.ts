import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { tokenService, TokenService } from '../services/token.service.js';
import { challengeRepository } from '../repositories/challenge.repository.js';
import type { SubmitSolutionSuccessResponse } from '../models/challenge.model.js';

describe('End-to-End CAPTCHA Flow Verification (Prompt 7)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Scenario A: Successful verification with incorrect attempt before success', () => {
    it('allows retry on wrong answer, consumes challenge on correct answer, and issues JWT', async () => {
      // 1. Create a new challenge over HTTP
      const createRes = await fetch(`${baseUrl}/api/v1/challenge`);
      expect(createRes.status).toBe(200);

      const challengeData = (await createRes.json()) as {
        challengeId: string;
        image: string;
        expiresAt: string;
        answer?: unknown;
      };

      expect(challengeData.challengeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(challengeData.image.startsWith('data:image/png;base64,')).toBe(true);
      expect(challengeData.expiresAt).toBeDefined();
      // Secret answer must strictly NOT be leaked in client response
      expect(challengeData.answer).toBeUndefined();

      // 2. Submit an incorrect answer -> returns 400 with code INVALID_ANSWER and remainingAttempts = 4
      const wrongRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          answer: '999999',
        }),
      });

      expect(wrongRes.status).toBe(400);
      const wrongData = (await wrongRes.json()) as {
        success: boolean;
        error: string;
        details: { code: string; remainingAttempts: number };
      };
      expect(wrongData.success).toBe(false);
      expect(wrongData.details.code).toBe('INVALID_ANSWER');
      expect(wrongData.details.remainingAttempts).toBe(4);

      // 3. Look up stored answer from server-side repository
      const stored = await challengeRepository.findById(challengeData.challengeId);
      expect(stored).not.toBeNull();
      const correctAnswer = stored!.answer;

      // 4. Submit correct answer before exhaustion -> returns 200 with signed verification token
      const correctRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          answer: correctAnswer,
        }),
      });

      expect(correctRes.status).toBe(200);
      const successData = (await correctRes.json()) as SubmitSolutionSuccessResponse;
      expect(successData.success).toBe(true);
      expect(successData.verificationToken).toBeDefined();
      expect(successData.expiresAt).toBeDefined();

      // 5. Challenge must be atomically consumed from repository
      const afterVerification = await challengeRepository.findById(challengeData.challengeId);
      expect(afterVerification).toBeNull();

      // 6. Submitting again on the consumed challenge must fail (single-use challenge verification)
      const repeatRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          answer: correctAnswer,
        }),
      });

      expect(repeatRes.status).toBe(400);
      const repeatData = (await repeatRes.json()) as { details: { code: string } };
      expect(repeatData.details.code).toBe('CHALLENGE_EXPIRED_OR_NOT_FOUND');
    });
  });

  describe('Scenario B: Attempt exhaustion and challenge invalidation', () => {
    it('invalidates a challenge when attempts reach the limit and rejects further submissions', async () => {
      // 1. Create a separate challenge
      const createRes = await fetch(`${baseUrl}/api/v1/challenge`);
      const { challengeId } = (await createRes.json()) as { challengeId: string };

      // 2. Submit 4 incorrect answers (attempts 1 to 4)
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(`${baseUrl}/api/v1/solution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId, answer: '000000' }),
        });

        expect(res.status).toBe(400);
        const data = (await res.json()) as { details: { code: string; remainingAttempts: number } };
        expect(data.details.code).toBe('INVALID_ANSWER');
        expect(data.details.remainingAttempts).toBe(5 - attempt);
      }

      // 3. 5th incorrect attempt exceeds maximum attempts -> exhausts and deletes challenge
      const fifthRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, answer: '000000' }),
      });

      expect(fifthRes.status).toBe(400);
      const fifthData = (await fifthRes.json()) as { details: { code: string } };
      expect(fifthData.details.code).toBe('ATTEMPTS_EXCEEDED');

      // 4. Stored record is completely purged from storage
      const stored = await challengeRepository.findById(challengeId);
      expect(stored).toBeNull();

      // 5. Subsequent submissions on the exhausted challenge fail with CHALLENGE_EXPIRED_OR_NOT_FOUND
      const afterRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, answer: '000000' }),
      });

      expect(afterRes.status).toBe(400);
      const afterData = (await afterRes.json()) as { details: { code: string } };
      expect(afterData.details.code).toBe('CHALLENGE_EXPIRED_OR_NOT_FOUND');
    });
  });

  describe('Scenario C: Token behavior and token reuse reality', () => {
    it('verifies the issued JWT claims and documents actual stateless token reuse behavior', async () => {
      // 1. Create and solve a separate challenge
      const createRes = await fetch(`${baseUrl}/api/v1/challenge`);
      const { challengeId } = (await createRes.json()) as { challengeId: string };

      const stored = await challengeRepository.findById(challengeId);
      const correctAnswer = stored!.answer;

      const solveRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, answer: correctAnswer }),
      });

      expect(solveRes.status).toBe(200);
      const { verificationToken } = (await solveRes.json()) as SubmitSolutionSuccessResponse;

      // 2. Verify the issued JWT claims using TokenService
      const claims1 = await tokenService.verifyVerificationToken(verificationToken);
      expect(claims1.sub).toBe(challengeId);
      expect(claims1.type).toBe('captcha_verification');
      expect(claims1.jti).toBeDefined();
      expect(claims1.exp).toBeGreaterThan(claims1.iat);

      // 3. ACTUAL TOKEN REUSE BEHAVIOR (Documented honestly):
      // Because TokenService is a stateless cryptographic validation service and does not
      // store a server-side list of redeemed tokens, the token itself CAN be verified multiple
      // times until its expiration (exp) timestamp passes.
      // Replay prevention is the responsibility of the consumer application (by storing claims.jti).
      const claims2 = await tokenService.verifyVerificationToken(verificationToken);
      expect(claims2.jti).toBe(claims1.jti);
      expect(claims2.sub).toBe(challengeId);

      // 4. Verify that once a token is expired, TokenService strictly rejects it
      const expiredService = new TokenService(
        'development_only_jwt_secret_key_change_in_production_min32',
        'HS256',
        -10, // already expired
      );
      const { token: expiredToken } = await expiredService.createVerificationToken(challengeId);

      await expect(tokenService.verifyVerificationToken(expiredToken)).rejects.toThrow(
        'Verification token is invalid, expired, or tampered',
      );
    });
  });
});
