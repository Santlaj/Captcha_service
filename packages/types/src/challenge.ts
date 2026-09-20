import { z } from 'zod';

/**
 * Supported CAPTCHA types. Currently limited to numeric image challenges.
 */
export const ChallengeTypeSchema = z.enum(['numeric_image']);
export type ChallengeType = z.infer<typeof ChallengeTypeSchema>;

/**
 * Canonical client response returned by GET /api/v1/challenge.
 * Secret answer is strictly omitted.
 */
export const ChallengeClientResponseSchema = z.object({
  challengeId: z.string().uuid(),
  image: z.string(), // Base64 PNG data URI
  expiresAt: z.string(), // ISO 8601 string timestamp
});

export type ChallengeClientResponse = z.infer<typeof ChallengeClientResponseSchema>;

/**
 * Legacy Challenge Payload schema.
 */
export const ChallengePayloadSchema = z.object({
  challengeId: z.string().uuid(),
  challengeType: ChallengeTypeSchema.optional(),
  prompt: z.string().optional(),
  image: z.string().optional(),
  imageData: z.string().optional(),
  expiresAt: z.union([z.number().int().positive(), z.string()]),
});

export type ChallengePayload = z.infer<typeof ChallengePayloadSchema>;


/**
 * Request schema to initiate a new challenge.
 */
export const CreateChallengeRequestSchema = z.object({
  siteKey: z.string().min(10),
});

export type CreateChallengeRequest = z.infer<typeof CreateChallengeRequestSchema>;
