import type { Request, Response, NextFunction } from 'express';
import { challengeService } from '../services/challenge.service.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export class ChallengeController {
  /**
   * Endpoint: GET /api/v1/challenge
   * Generates a new numeric CAPTCHA challenge, stores its secret answer in Redis with a 5-minute TTL,
   * and returns the challengeId, base64 image data URI, and expiration timestamp.
   */
  async createChallenge(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const challenge = await challengeService.createChallenge();

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.status(200).json(challenge);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Development-only preview endpoint: GET /api/v1/challenge/preview
   * Directly streams the rendered PNG image buffer.
   * Disabled in production environments.
   */
  async getPreview(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!config.enablePreviewEndpoint) {
        throw ApiError.notFound('Preview endpoint is disabled in production');
      }

      const preview = await challengeService.getChallengePreview();

      res.setHeader('Content-Type', preview.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.status(200).send(preview.imageBuffer);
    } catch (error) {
      next(error);
    }
  }
}

export const challengeController = new ChallengeController();
