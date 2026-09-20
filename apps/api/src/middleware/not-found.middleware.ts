import type { Request, Response } from 'express';

/**
 * Middleware to handle unmatched routes with a clear 404 response.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  });
}
