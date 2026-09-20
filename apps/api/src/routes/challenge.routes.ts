import { Router } from 'express';
import { challengeController } from '../controllers/challenge.controller.js';
import { createRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { config } from '../config/env.js';

const router: Router = Router();

const challengeRateLimiter = createRateLimiter({
  action: 'create_challenge',
  maxRequests: config.rateLimits.challengePerMinute,
  windowSeconds: 60,
});

/**
 * GET /api/v1/challenge
 * Generates a new numeric challenge, stores answer in Redis, and returns challengeId & base64 image.
 */
router.get('/', challengeRateLimiter, (req, res, next) => {
  void challengeController.createChallenge(req, res, next);
});

/**
 * GET /api/v1/challenge/preview
 * Development-only preview streaming raw PNG image directly.
 */
router.get('/preview', challengeRateLimiter, (req, res, next) => {
  void challengeController.getPreview(req, res, next);
});

export const challengeRoutes: Router = router;
