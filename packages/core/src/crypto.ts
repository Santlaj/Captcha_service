import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Creates an HMAC SHA-256 signature for a string payload using a secret key.
 */
export function createHmacSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Performs a constant-time comparison of the provided signature against the computed HMAC.
 * Protects against timing attacks.
 */
export function verifyHmacSignature(
  payload: string,
  providedSignature: string,
  secret: string,
): boolean {
  const expectedSignature = createHmacSignature(payload, secret);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(providedSignature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Generates a cryptographically secure random hexadecimal identifier.
 */
export function generateSecureId(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
