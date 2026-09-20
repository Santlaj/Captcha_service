/**
 * Standard API error class carrying HTTP status codes and optional details.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, message);
  }

  static tooManyRequests(message = 'Too many requests. Please try again later.', details?: unknown): ApiError {
    return new ApiError(429, message, details);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', details?: unknown): ApiError {
    return new ApiError(503, message, details);
  }
}
