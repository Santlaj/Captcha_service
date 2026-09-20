import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ApiError } from '../utils/api-error.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized error-handling middleware.
 * Catches all errors passed via next(err), formats standard JSON responses,
 * and ensures status codes and error messages are consistent across the API.
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Handle body-parser / express.json payload size errors
  if ('type' in err && (err as { type?: unknown }).type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: 'Payload too large. Request body exceeds the 10KB size limit.',
      code: 'PAYLOAD_TOO_LARGE',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Handle malformed JSON syntax errors
  if ('type' in err && (err as { type?: unknown }).type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: 'Malformed JSON payload. Please provide valid JSON.',
      code: 'MALFORMED_JSON',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Handle CORS policy rejection errors
  if (err.message && err.message.includes('CORS origin')) {
    res.status(403).json({
      success: false,
      error: 'CORS request forbidden: origin is not in the allowed list.',
      code: 'CORS_FORBIDDEN',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Unhandled / Unexpected internal errors (never leak stack trace or internal messages to client)
  logger.error('Unhandled internal error:', err);

  res.status(500).json({
    success: false,
    error: 'An unexpected internal server error occurred',
    timestamp: new Date().toISOString(),
  });
};
