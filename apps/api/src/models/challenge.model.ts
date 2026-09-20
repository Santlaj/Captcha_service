import type { ChallengePayload, CreateChallengeRequest } from '@captcha-service/types';

/**
 * Server-side stored challenge record (stored in Redis).
 * CRITICAL SECURITY INVARIANT:
 * Contains the secret answer; this object must NEVER be sent in client HTTP responses.
 */
export interface StoredChallenge {
  id: string;          // Cryptographically random unique challenge ID (UUID)
  answer: string;      // Secret 6-digit numeric answer (e.g. "004281")
  createdAt: string;   // ISO 8601 creation timestamp
  expiresAt: string;   // ISO 8601 expiration timestamp
  attempts: number;    // Number of failed verification attempts so far
  maxAttempts: number; // Maximum allowed attempts before invalidation (default: 5)
}

/**
 * Verification outcome status codes.
 */
export type VerificationStatus =
  | 'SUCCESS'
  | 'INCORRECT'
  | 'EXHAUSTED'
  | 'NOT_FOUND'
  | 'EXPIRED';

/**
 * Result returned by the repository verification operation.
 */
export interface VerificationResult {
  status: VerificationStatus;
  remainingAttempts?: number;
}

/**
 * Verification Token claims signed with JWT.
 * Note: A signed token is NOT automatically single-use. Replay protection
 * requires tracking the jti in a redemption store when validated by a backend.
 */
export interface VerificationTokenClaims {
  sub: string;         // Challenge ID
  jti: string;         // Unique token ID
  type: 'captcha_verification';
  iat: number;
  exp: number;
}

/**
 * Client-facing challenge response returned by GET /api/v1/challenge.
 */
export interface ChallengeClientResponse {
  challengeId: string; // Unique challenge identifier
  image: string;       // Base64 Data URI: "data:image/png;base64,..."
  expiresAt: string;   // ISO 8601 expiration timestamp
}

/**
 * Request payload for POST /api/v1/solution.
 */
export interface SubmitSolutionRequest {
  challengeId: string;
  answer: string;
}

/**
 * Successful response for POST /api/v1/solution.
 */
export interface SubmitSolutionSuccessResponse {
  success: true;
  verificationToken: string;
  expiresAt: string;
}

/**
 * Internal result from challenge generation containing both the secret answer and the rendered image.
 */
export interface InternalChallengeResult {
  answer: string;      // 6-digit numeric string (e.g. "004281")
  imageBuffer: Buffer; // PNG image buffer
  createdAt: Date;
}

/**
 * Public preview result for development preview endpoints.
 */
export interface ChallengePreviewResult {
  imageBuffer: Buffer;
  contentType: 'image/png';
}

export type { ChallengePayload, CreateChallengeRequest };
