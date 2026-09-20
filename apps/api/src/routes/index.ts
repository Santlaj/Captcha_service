import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { challengeRoutes } from './challenge.routes.js';
import { solutionRoutes } from './solution.routes.js';
import { siteverifyRoutes } from './siteverify.routes.js';

const router: Router = Router();

// Root health check endpoint (GET /health)
router.use(healthRoutes);

// Version 1 API routes
router.use('/api/v1/challenge', challengeRoutes);
router.use('/api/v1/solution', solutionRoutes);
router.use('/api/v1/siteverify', siteverifyRoutes);

export const apiRoutes: Router = router;
