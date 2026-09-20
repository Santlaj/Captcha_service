import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { apiRoutes } from './routes/index.js';
import { notFoundHandler } from './middleware/not-found.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const captchaScriptPath = path.resolve(__dirname, 'public', 'captcha.js');

export function createApp(): Express {
  const app = express();

  // Configure trust proxy based on explicit environment configuration
  // Never blindly trust arbitrary forwarded headers unless explicitly configured
  app.set('trust proxy', config.trustProxy);

  // Security headers with cross-origin resource policy enabled for SDK assets
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS configuration: explicit allowlist, method and header restrictions, never wildcard + credentials
  const hasWildcardOrigin = config.corsOrigins.includes('*');

  app.use(
    cors({
      origin: hasWildcardOrigin
        ? '*'
        : (origin, callback) => {
            // Allow server-to-server or non-browser tools where origin header is undefined
            if (!origin) {
              return callback(null, true);
            }
            if (config.corsOrigins.includes(origin)) {
              return callback(null, true);
            }
            // In development, automatically permit any localhost / 127.0.0.1 port
            if (config.nodeEnv === 'development' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
              return callback(null, true);
            }
            // Disallowed origin
            return callback(new Error(`CORS origin '${origin}' not allowed by server policy`));
          },
      credentials: !hasWildcardOrigin,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Site-Key', 'x-test-rate-limit'],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
      maxAge: 86400, // 24 hours
    }),
  );

  // Parse JSON payloads and URL-encoded form data (supports reCAPTCHA-style siteverify)
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // Serve standalone embeddable vanilla JS widget script for non-React websites
  app.get(['/captcha.js', '/api/v1/widget.js'], (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(captchaScriptPath);
  });

  // Mount API and health routes
  app.use(apiRoutes);

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
