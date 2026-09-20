import { Redis } from 'ioredis';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Creates and configures the Redis client connection.
 * Utilizes predictable URL parsing, explicit passwords, connection timeout, and retry options.
 */
function createRedisClient(): Redis {
  const commonOptions = {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: true,
    enableOfflineQueue: true,
    ...(config.redis.password ? { password: config.redis.password } : {}),
  };

  const client = config.redis.url
    ? new Redis(config.redis.url, commonOptions)
    : new Redis({
        host: config.redis.host,
        port: config.redis.port,
        ...commonOptions,
      });

  client.on('connect', () => {
    logger.info('Connected to Redis');
  });

  client.on('error', (err: Error) => {
    logger.error('Redis connection error:', err.message);
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return client;
}

export const redisClient = createRedisClient();

/**
 * Gracefully shuts down the Redis connection pool.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient.status !== 'end') {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed gracefully.');
    } catch {
      redisClient.disconnect();
    }
  }
}
