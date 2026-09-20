import type { Request, Response, NextFunction } from 'express';
import { siteVerifyService, SiteVerifyService } from '../services/siteverify.service.js';
import { SiteVerifyRequestSchema, type SiteVerifyResponse } from '@captcha-service/types';
import { ApiError } from '../utils/api-error.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class SiteVerifyController {
  constructor(private readonly service: SiteVerifyService = siteVerifyService) {}

  /**
   * Handles POST /api/v1/siteverify.
   * Compatible with JSON payloads and application/x-www-form-urlencoded.
   */
  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawBody = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      
      // Normalize various common property naming conventions
      const normalizedBody = {
        secretKey:
          (rawBody['secretKey'] as string) ||
          (rawBody['secret'] as string) ||
          (rawBody['secret_key'] as string) ||
          (config.nodeEnv === 'development' ? config.siteverify.secretKey : ''),
        token:
          (rawBody['token'] as string) ||
          (rawBody['response'] as string) ||
          (rawBody['captcha_token'] as string) ||
          (rawBody['captchaToken'] as string) ||
          '',
        remoteIp:
          (rawBody['remoteIp'] as string) ||
          (rawBody['remoteip'] as string) ||
          (rawBody['remote_ip'] as string),
      };

      logger.info('[SITEVERIFY_INCOMING]', JSON.stringify(rawBody));
      logger.info('[SITEVERIFY_NORMALIZED]', JSON.stringify({ ...normalizedBody, secretKey: '***' }));

      const parseResult = SiteVerifyRequestSchema.safeParse(normalizedBody);

      if (!parseResult.success) {
        logger.warn('[SITEVERIFY_PARSE_ERROR]', JSON.stringify(parseResult.error.errors));
        const response: SiteVerifyResponse = {
          success: false,
          errorCodes: ['invalid-input-response'],
        };
        res.status(200).json(response);
        return;
      }

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      const hostname = req.hostname;

      const result = await this.service.verifySiteToken(
        {
          ...parseResult.data,
          remoteIp: parseResult.data.remoteIp || clientIp,
        },
        hostname,
      );

      logger.info('[SITEVERIFY_RESULT]', JSON.stringify(result));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const siteVerifyController = new SiteVerifyController();
