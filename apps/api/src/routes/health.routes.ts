import { Router } from 'express';
import { healthController } from '../controllers/health.controller.js';

const router: Router = Router();

// GET /health
router.get('/health', (req, res, next) => {
  healthController.getHealth(req, res, next);
});

export const healthRoutes: Router = router;
