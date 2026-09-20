import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env if present
dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5180'),
    CAPTCHA_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
    MAX_VERIFICATION_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    JWT_SECRET: z.string().default('development_only_jwt_secret_key_change_in_production_min32'),
    JWT_ALGORITHM: z.enum(['HS256', 'HS384', 'HS512']).default('HS256'),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(10).max(86400).default(300),
    RATE_LIMIT_CHALLENGE_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(60),
    RATE_LIMIT_SOLUTION_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(30),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        const num = Number(val);
        if (!isNaN(num) && Number.isInteger(num)) return num; // e.g. 1 hop
        return val; // IP list, CIDR string (e.g. '10.0.0.0/8,172.16.0.0/12')
      }),
    ENABLE_PREVIEW_ENDPOINT: z
      .string()
      .optional()
      .transform((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        return process.env['NODE_ENV'] !== 'production';
      }),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_PASSWORD: z.string().optional(),
    SITEVERIFY_SECRET_KEY: z.string().optional(),
  })
  .refine(
    (data) => {
      // In production, enforce strong JWT secret
      if (data.NODE_ENV === 'production') {
        return (
          data.JWT_SECRET.length >= 32 &&
          !data.JWT_SECRET.includes('development_only')
        );
      }
      return true;
    },
    {
      message:
        'In production, JWT_SECRET must be at least 32 characters long and not use the development default.',
      path: ['JWT_SECRET'],
    },
  );

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const errorDetails = parsedEnv.error.errors
    .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  console.error(`[FATAL] Environment configuration validation failed:\n${errorDetails}`);
  throw new Error(`Environment validation failed:\n${errorDetails}`);
}

const rawConfig = parsedEnv.data;

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  corsOrigins: string[];
  captchaTtlSeconds: number;
  maxVerificationAttempts: number;
  trustProxy: boolean | number | string;
  enablePreviewEndpoint: boolean;
  jwt: {
    secret: string;
    algorithm: 'HS256' | 'HS384' | 'HS512';
    expiresInSeconds: number;
  };
  siteverify: {
    secretKey: string;
  };
  rateLimits: {
    challengePerMinute: number;
    solutionPerMinute: number;
  };
  redis: {
    url: string;
    host: string;
    port: number;
    password?: string;
  };
}

export const config: AppConfig = {
  port: rawConfig.PORT,
  host: rawConfig.HOST,
  nodeEnv: rawConfig.NODE_ENV,
  corsOrigins: rawConfig.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
  captchaTtlSeconds: rawConfig.CAPTCHA_TTL_SECONDS,
  maxVerificationAttempts: rawConfig.MAX_VERIFICATION_ATTEMPTS,
  trustProxy: rawConfig.TRUST_PROXY,
  enablePreviewEndpoint: rawConfig.ENABLE_PREVIEW_ENDPOINT,
  jwt: {
    secret: rawConfig.JWT_SECRET,
    algorithm: rawConfig.JWT_ALGORITHM,
    expiresInSeconds: rawConfig.JWT_EXPIRES_IN_SECONDS,
  },
  siteverify: {
    secretKey: rawConfig.SITEVERIFY_SECRET_KEY || rawConfig.JWT_SECRET,
  },
  rateLimits: {
    challengePerMinute: rawConfig.RATE_LIMIT_CHALLENGE_PER_MINUTE,
    solutionPerMinute: rawConfig.RATE_LIMIT_SOLUTION_PER_MINUTE,
  },
  redis: {
    url: rawConfig.REDIS_URL,
    host: rawConfig.REDIS_HOST,
    port: rawConfig.REDIS_PORT,
    password: rawConfig.REDIS_PASSWORD || undefined,
  },
};
