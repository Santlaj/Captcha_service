import { describe, it, expect } from 'vitest';
import { TokenService } from '../token.service.js';
import { SignJWT } from 'jose';

describe('TokenService - JWT Signing & Verification', () => {
  const secret = 'test_secret_key_at_least_32_characters_long_for_hs256';
  const tokenService = new TokenService(secret, 'HS256', 300);

  it('generates a valid signed JWT verification token with correct claims', async () => {
    const challengeId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const { token, expiresAt } = await tokenService.createVerificationToken(challengeId);

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // Header.Payload.Signature
    expect(expiresAt).toBeDefined();

    // Verify token claims
    const claims = await tokenService.verifyVerificationToken(token);
    expect(claims.sub).toBe(challengeId);
    expect(claims.type).toBe('captcha_verification');
    expect(claims.jti).toBeDefined();
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
    expect(claims.exp - claims.iat).toBe(300);
  });

  it('rejects a tampered token where payload was modified', async () => {
    const { token } = await tokenService.createVerificationToken('valid-challenge-id');
    const parts = token.split('.');

    // Tamper with payload
    const decodedPayload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'));
    decodedPayload.sub = 'attacker-forged-challenge-id';
    const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');

    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(tokenService.verifyVerificationToken(tamperedToken)).rejects.toThrow(
      'Verification token is invalid, expired, or tampered',
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const foreignService = new TokenService('different_secret_key_32_chars_long_for_testing', 'HS256', 300);
    const { token } = await foreignService.createVerificationToken('some-id');

    await expect(tokenService.verifyVerificationToken(token)).rejects.toThrow(
      'Verification token is invalid, expired, or tampered',
    );
  });

  it('rejects an expired token', async () => {
    const shortLivedService = new TokenService(secret, 'HS256', -10); // Expired 10 seconds ago
    const { token } = await shortLivedService.createVerificationToken('some-id');

    await expect(tokenService.verifyVerificationToken(token)).rejects.toThrow(
      'Verification token is invalid, expired, or tampered',
    );
  });

  it('rejects a token with an invalid token type', async () => {
    const secretKey = new TextEncoder().encode(secret);
    const forgedToken = await new SignJWT({
      type: 'user_session', // Wrong type
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('challenge-123')
      .setJti('jti-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secretKey);

    await expect(tokenService.verifyVerificationToken(forgedToken)).rejects.toThrow(
      'Invalid token: incorrect token type',
    );
  });

  it('rejects a token signed with a mismatched algorithm', async () => {
    const secretKey = new TextEncoder().encode(secret);
    // Sign with HS384 when tokenService is configured for HS256
    const forgedToken = await new SignJWT({
      type: 'captcha_verification',
    })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('challenge-123')
      .setJti('jti-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secretKey);

    await expect(tokenService.verifyVerificationToken(forgedToken)).rejects.toThrow(
      'Verification token is invalid, expired, or tampered',
    );
  });

  it('rejects a token missing required claims (e.g., missing jti)', async () => {
    const secretKey = new TextEncoder().encode(secret);
    const forgedToken = await new SignJWT({
      type: 'captcha_verification',
      // jti omitted
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('challenge-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secretKey);

    await expect(tokenService.verifyVerificationToken(forgedToken)).rejects.toThrow(
      'Invalid token: missing required claims',
    );
  });
});

