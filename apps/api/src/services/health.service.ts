import type { HealthResponse } from '../models/health.model.js';

export class HealthService {
  /**
   * Retrieves current server health and uptime statistics.
   */
  getHealthStatus(): HealthResponse {
    return {
      status: 'ok',
      service: 'captcha-service-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthService = new HealthService();
