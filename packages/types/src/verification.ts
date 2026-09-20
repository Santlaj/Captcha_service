import { z } from 'zod';

/**
 * Client submission containing the user's solved numeric code for POST /api/v1/solution.
 */
export const SubmitSolutionRequestSchema = z.object({
  challengeId: z.string().uuid('challengeId must be a valid UUID'),
  answer: z.string().regex(/^\d{6}$/, 'Answer must be exactly 6 numeric digits'),
});

export type SubmitSolutionRequest = z.infer<typeof SubmitSolutionRequestSchema>;

/**
 * Successful response returned by POST /api/v1/solution.
 */
export const SubmitSolutionSuccessResponseSchema = z.object({
  success: z.literal(true),
  verificationToken: z.string(),
  expiresAt: z.string(),
});

export type SubmitSolutionSuccessResponse = z.infer<typeof SubmitSolutionSuccessResponseSchema>;

/**
 * Standard API error response envelope.
 */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  timestamp: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/**
 * Verification Token claims signed with JWT.
 */
export const VerificationTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  jti: z.string().uuid(),
  type: z.literal('captcha_verification'),
  iat: z.number(),
  exp: z.number(),
});

export type VerificationTokenClaims = z.infer<typeof VerificationTokenClaimsSchema>;

/**
 * Legacy response schema.
 */
export const SubmitSolutionResponseSchema = z.object({
  success: z.boolean(),
  verificationToken: z.string().optional(),
  error: z.string().optional(),
});

export type SubmitSolutionResponse = z.infer<typeof SubmitSolutionResponseSchema>;


/**
 * Server-to-server site verification request.
 * Backend applications call this using their private secret key to verify a token.
 */
export const SiteVerifyRequestSchema = z
  .object({
    secretKey: z.string().optional(),
    secret: z.string().optional(),
    token: z.string().optional(),
    response: z.string().optional(),
    remoteIp: z.string().optional(),
    remoteip: z.string().optional(),
  })
  .transform((data) => {
    const resolvedSecret = data.secretKey || data.secret || '';
    const resolvedToken = data.token || data.response || '';
    const resolvedIp = data.remoteIp || data.remoteip;
    return {
      secretKey: resolvedSecret,
      token: resolvedToken,
      remoteIp: resolvedIp,
    };
  })
  .refine((data) => data.secretKey.length >= 16, {
    message: 'secret or secretKey must be at least 16 characters',
    path: ['secretKey'],
  })
  .refine((data) => data.token.length >= 10, {
    message: 'token or response must be at least 10 characters',
    path: ['token'],
  });

export type SiteVerifyRequest = z.infer<typeof SiteVerifyRequestSchema>;

/**
 * Server-to-server site verification response.
 */
export const SiteVerifyResponseSchema = z.object({
  success: z.boolean(),
  challengeTimestamp: z.number().int().positive().optional(),
  hostname: z.string().optional(),
  errorCodes: z.array(z.string()).optional(),
});

export type SiteVerifyResponse = z.infer<typeof SiteVerifyResponseSchema>;
