import { randomInt, randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { config } from '../config/env.js';
import type {
  InternalChallengeResult,
  ChallengePreviewResult,
  ChallengeClientResponse,
  StoredChallenge,
  SubmitSolutionSuccessResponse,
} from '../models/challenge.model.js';
import {
  type IChallengeRepository,
  challengeRepository,
} from '../repositories/challenge.repository.js';
import { TokenService, tokenService } from './token.service.js';
import { ApiError } from '../utils/api-error.js';

/**
 * Generates a cryptographically secure, random 6-digit numeric string.
 * Supports leading zeros natively (e.g. "004281").
 * Accepts an optional rng function for deterministic testing.
 */
export function generateRandomNumericAnswer(
  length = 6,
  rng: (min: number, max: number) => number = randomInt,
): string {
  let answer = '';
  for (let i = 0; i < length; i++) {
    answer += rng(0, 10).toString();
  }
  return answer;
}

export class ChallengeService {
  constructor(
    private readonly repository: IChallengeRepository = challengeRepository,
    private readonly tokens: TokenService = tokenService,
    private readonly ttlSeconds: number = config.captchaTtlSeconds,
    private readonly maxAttempts: number = config.maxVerificationAttempts,
  ) {}

  /**
   * Main challenge creation flow:
   * 1. Generates a random 6-digit answer.
   * 2. Renders the CAPTCHA image as PNG.
   * 3. Generates a cryptographically unique challenge ID (UUID) with collision retry (SET NX).
   * 4. Stores the answer, attempts=0, maxAttempts, and timestamps in Redis with TTL.
   * 5. Returns public challenge response with answer strictly omitted.
   */
  async createChallenge(): Promise<ChallengeClientResponse> {
    const answer = generateRandomNumericAnswer(6);
    const imageBuffer = this.renderNumericCaptchaImage(answer);

    const now = new Date();
    const expiresAtDate = new Date(now.getTime() + this.ttlSeconds * 1000);

    // Collision retry loop using atomic NX in repository
    let stored = false;
    let attempts = 0;
    let challengeId = randomUUID();

    while (!stored && attempts < 3) {
      attempts++;
      challengeId = randomUUID();

      const storedChallenge: StoredChallenge = {
        id: challengeId,
        answer,
        createdAt: now.toISOString(),
        expiresAt: expiresAtDate.toISOString(),
        attempts: 0,
        maxAttempts: this.maxAttempts,
      };

      stored = await this.repository.save(storedChallenge, this.ttlSeconds);
    }

    if (!stored) {
      throw ApiError.internal('Failed to generate a unique challenge ID. Please try again.');
    }

    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    return {
      challengeId,
      image: base64Image,
      expiresAt: expiresAtDate.toISOString(),
    };
  }

  /**
   * Verifies user-submitted solution and issues a signed token:
   *
   * SAFE CONSUMPTION PATTERN (Prompt 4, Issue 1):
   * 1. Prepare and pre-sign the token in-memory BEFORE modifying Redis state.
   *    If token signing fails (e.g. crypto error, invalid key), this throws immediately,
   *    and the challenge in Redis is NOT consumed, remaining completely intact for retry.
   * 2. Perform atomic verification and single-use consumption in Redis (Lua script).
   *    The Redis Lua script guarantees that concurrent requests cannot verify the challenge twice.
   * 3. If correct, return the prepared signed token.
   * 4. If incorrect, discarded token is garbage-collected and never returned.
   *
   * Trade-offs:
   * - Minimal CPU overhead to sign JWT (< 0.1ms) in exchange for zero state inconsistency.
   * - Avoids complex two-phase distributed locks in Redis which risk deadlock on worker crash.
   */
  async verifySolution(challengeId: string, answer: string): Promise<SubmitSolutionSuccessResponse> {
    // Step 1: Pre-sign token in-memory first. If crypto fails, Redis is completely untouched!
    const tokenResult = await this.tokens.createVerificationToken(challengeId);

    // Step 2: Atomically verify and consume challenge in Redis
    const result = await this.repository.verifyAndConsume(challengeId, answer, this.maxAttempts);

    switch (result.status) {
      case 'SUCCESS': {
        // Challenge was atomically deleted from Redis. Deliver the signed token.
        return {
          success: true,
          verificationToken: tokenResult.token,
          expiresAt: tokenResult.expiresAt,
        };
      }

      case 'INCORRECT': {
        // Token is discarded
        throw ApiError.badRequest('Incorrect CAPTCHA answer', {
          code: 'INVALID_ANSWER',
          remainingAttempts: result.remainingAttempts,
        });
      }

      case 'EXHAUSTED': {
        // Token is discarded
        throw ApiError.badRequest('Maximum verification attempts exceeded. Challenge has been invalidated.', {
          code: 'ATTEMPTS_EXCEEDED',
        });
      }

      case 'NOT_FOUND':
      case 'EXPIRED': {
        // Token is discarded
        throw ApiError.badRequest('Challenge has expired or does not exist. Please request a new CAPTCHA.', {
          code: 'CHALLENGE_EXPIRED_OR_NOT_FOUND',
        });
      }
    }
  }

  /**
   * Generates an internal challenge result containing both the answer and the image buffer.
   */
  async generateNumericChallenge(): Promise<InternalChallengeResult> {
    const answer = generateRandomNumericAnswer(6);
    const imageBuffer = this.renderNumericCaptchaImage(answer);

    return {
      answer,
      imageBuffer,
      createdAt: new Date(),
    };
  }

  /**
   * Development preview endpoint method.
   */
  async getChallengePreview(): Promise<ChallengePreviewResult> {
    const { imageBuffer } = await this.generateNumericChallenge();

    return {
      imageBuffer,
      contentType: 'image/png',
    };
  }

  /**
   * Renders a 200x80 PNG image containing 6 digits using @napi-rs/canvas.
   */
  private renderNumericCaptchaImage(answer: string): Buffer {
    const width = 200;
    const height = 80;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Light background fill
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // 2. Background subtle noise lines (4 lines)
    const lineCount = 4;
    for (let i = 0; i < lineCount; i++) {
      ctx.strokeStyle = `rgba(${randomInt(130, 190)}, ${randomInt(130, 190)}, ${randomInt(130, 190)}, 0.45)`;
      ctx.lineWidth = 1 + Math.random();
      ctx.beginPath();
      ctx.moveTo(randomInt(0, width), randomInt(0, height));
      ctx.bezierCurveTo(
        randomInt(0, width),
        randomInt(0, height),
        randomInt(0, width),
        randomInt(0, height),
        randomInt(0, width),
        randomInt(0, height),
      );
      ctx.stroke();
    }

    // 3. Background noise dots (approx 35 dots)
    const dotCount = 35;
    for (let i = 0; i < dotCount; i++) {
      ctx.fillStyle = `rgba(${randomInt(100, 180)}, ${randomInt(100, 180)}, ${randomInt(100, 180)}, 0.4)`;
      ctx.beginPath();
      ctx.arc(randomInt(0, width), randomInt(0, height), 1 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Six readable digits with moderate rotation and slight position jitter
    const digitColors = ['#0f172a', '#1e293b', '#334155', '#1e3a8a', '#164e63', '#1e1b4b'];

    for (let i = 0; i < answer.length; i++) {
      const digit = answer[i] ?? '';
      const colorIndex = randomInt(0, digitColors.length);
      const color = digitColors[colorIndex] ?? '#0f172a';

      ctx.save();
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;

      const x = 24 + i * 26 + randomInt(-2, 3);
      const y = 42 + randomInt(-4, 5);
      const rotationAngle = (randomInt(-12, 13) * Math.PI) / 180;

      ctx.translate(x, y);
      ctx.rotate(rotationAngle);
      ctx.fillText(digit, 0, 0);
      ctx.restore();
    }

    // 5. Light foreground noise lines crossing over digits
    for (let i = 0; i < 2; i++) {
      ctx.strokeStyle = `rgba(${randomInt(140, 200)}, ${randomInt(140, 200)}, ${randomInt(140, 200)}, 0.35)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(randomInt(0, width), randomInt(0, height));
      ctx.lineTo(randomInt(0, width), randomInt(0, height));
      ctx.stroke();
    }

    return canvas.toBuffer('image/png');
  }
}

export const challengeService = new ChallengeService();
