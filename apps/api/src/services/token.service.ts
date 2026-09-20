import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import type { VerificationTokenClaims } from '../models/challenge.model.js';
import { ApiError } from '../utils/api-error.js';
import { logger } from '../utils/logger.js';

/**
 * TokenService manages cryptographic signing and verification of short-lived verification tokens.
 *
 * CRITICAL SECURITY & ARCHITECTURAL PRINCIPLES:
 * 1. Scope of Guarantee:
 *    A CAPTCHA verification token proves solely that a specific numeric challenge was successfully
 *    solved by a human client within the configured validity window.
 *    IT DOES NOT PROVIDE USER AUTHENTICATION OR AUTHORIZATION. It does not establish a user identity,
 *    create a login session, or grant permissions.
 *
 * 2. Replay Prevention:
 *    A signed JWT is self-contained and cryptographically tamper-proof, but is NOT automatically
 *    single-use by itself. A valid token can be replayed until its `exp` timestamp unless the
 *    consuming application backend tracks the unique token ID (`claims.jti`) in a database or
 *    Redis cache upon redemption (e.g. form submission) to reject subsequent redemptions.
 *
 * 3. Algorithm Whitelisting:
 *    Verification enforces strict whitelisting of the configured symmetric algorithm (e.g., HS256)
 *    to prevent algorithm-confusion and 'none' algorithm bypass attacks.
 */
export class TokenService {
  private readonly secretKey: Uint8Array;
  private readonly algorithm: string;
  private readonly expiresInSeconds: number;

  constructor(
    secret: string = config.jwt.secret,
    algorithm: string = config.jwt.algorithm,
    expiresInSeconds: number = config.jwt.expiresInSeconds,
  ) {
    this.secretKey = new TextEncoder().encode(secret);
    this.algorithm = algorithm;
    this.expiresInSeconds = expiresInSeconds;
  }

  /**
   * Generates a signed verification token for a successfully solved challenge.
   *
   * Claims:
   * - sub: challengeId (the ID of the challenge that was solved)
   * - jti: unique token ID (UUID)
   * - type: "captcha_verification"
   * - iat: issued at timestamp
   * - exp: expiration timestamp
   *
   * The secret answer is NEVER included in claims.
   */
  async createVerificationToken(challengeId: string): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const jti = randomUUID();
    const expiresAtDate = new Date(Date.now() + this.expiresInSeconds * 1000);

    const token = await new SignJWT({
      type: 'captcha_verification',
    })
      .setProtectedHeader({ alg: this.algorithm })
      .setSubject(challengeId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${this.expiresInSeconds}s`)
      .sign(this.secretKey);

    return {
      token,
      expiresAt: expiresAtDate.toISOString(),
    };
  }

  /**
   * Reusable token verification utility.
   *
   * Validates:
   * 1. Cryptographic signature using the configured secret key.
   * 2. Allowed algorithm (prevents algorithm-switching attacks like 'none').
   * 3. Expiration time.
   * 4. Token type matching "captcha_verification".
   * 5. Presence of required claims (sub, jti, iat, exp).
   *
   * Returns validated claims or throws an ApiError if invalid.
   */
  async verifyVerificationToken(token: string): Promise<VerificationTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        algorithms: [this.algorithm],
      });

      // Enforce expected token type
      if (payload['type'] !== 'captcha_verification') {
        throw ApiError.unauthorized('Invalid token: incorrect token type');
      }

      // Enforce required claims
      if (!payload.sub || !payload.jti || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
        throw ApiError.unauthorized('Invalid token: missing required claims');
      }

      return {
        sub: payload.sub,
        jti: payload.jti,
        type: 'captcha_verification',
        iat: payload.iat,
        exp: payload.exp,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.warn('Token verification failed:', error instanceof Error ? error.message : error);
      throw ApiError.unauthorized('Verification token is invalid, expired, or tampered');
    }
  }
}

export const tokenService = new TokenService();
