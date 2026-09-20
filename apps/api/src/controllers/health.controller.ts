import type { Request, Response, NextFunction } from 'express';
import { healthService } from '../services/health.service.js';

export class HealthController {
  /**
   * Handles GET /health.
   * Delegates status generation to HealthService and sends the HTTP response.
   */
  getHealth(_req: Request, res: Response, next: NextFunction): void {
    try {
      const status = healthService.getHealthStatus();
      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }
}

export const healthController = new HealthController();
