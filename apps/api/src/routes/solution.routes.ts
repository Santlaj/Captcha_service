import { Router } from 'express';
import { solutionController, SubmitSolutionSchema } from '../controllers/solution.controller.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createRateLimiter } from '../middleware/rate-limiter.middleware.js';
import { config } from '../config/env.js';

const router: Router = Router();

const solutionRateLimiter = createRateLimiter({
  action: 'verify_solution',
  maxRequests: config.rateLimits.solutionPerMinute,
  windowSeconds: 60,
});

/**
 * POST /api/v1/solution
 * Submits and verifies a 6-digit CAPTCHA solution.
 */
router.post(
  '/',
  validateBody(SubmitSolutionSchema),
  solutionRateLimiter,
  (req, res, next) => {
    void solutionController.verifySolution(req, res, next);
  },
);

export const solutionRoutes: Router = router;
