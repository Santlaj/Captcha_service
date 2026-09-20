import { Router } from 'express';
import { siteVerifyController } from '../controllers/siteverify.controller.js';
import { createRateLimiter } from '../middleware/rate-limiter.middleware.js';

const router: Router = Router();

const siteverifyRateLimiter = createRateLimiter({
  action: 'siteverify',
  maxRequests: 120,
  windowSeconds: 60,
});

/**
 * POST /api/v1/siteverify
 * Server-to-server endpoint to verify verification tokens.
 * Supports both JSON and application/x-www-form-urlencoded.
 */
router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'online',
    endpoint: 'POST /api/v1/siteverify',
    message: 'CAPTCHA site verification endpoint is active.',
  });
});

router.post('/', siteverifyRateLimiter, (req, res, next) => {
  void siteVerifyController.verify(req, res, next);
});

export const siteverifyRoutes: Router = router;
