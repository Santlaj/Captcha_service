import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { challengeService } from '../services/challenge.service.js';

import { logger } from '../utils/logger.js';

export const SubmitSolutionSchema = z
  .object({
    challengeId: z.string().uuid('challengeId must be a valid UUID'),
    answer: z.string().regex(/^\d{6}$/, 'Answer must be exactly 6 numeric digits'),
  })
  .strict();


export class SolutionController {
  /**
   * Endpoint: POST /api/v1/solution
   * Verifies the submitted 6-digit answer against the challenge in Redis.
   * On success:
   * - Atomically deletes the challenge to prevent reuse.
   * - Issues a cryptographically signed JWT verification token.
   * - Returns { success: true, verificationToken, expiresAt }.
   */
  async verifySolution(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { challengeId, answer } = req.body as z.infer<typeof SubmitSolutionSchema>;
      logger.info(`[VERIFY_SOLUTION_RECEIVED] challengeId=${challengeId}, answer=${answer}`);

      const result = await challengeService.verifySolution(challengeId, answer);
      logger.info(`[VERIFY_SOLUTION_SUCCESS] challengeId=${challengeId}`);

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const solutionController = new SolutionController();
