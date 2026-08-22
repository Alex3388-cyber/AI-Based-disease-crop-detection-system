import pino, { type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): Logger {
  return pino({
    level: config.logLevel,
    base: {
      service: 'crop-disease-api',
      environment: config.nodeEnv
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-service-secret',
        'headers.authorization',
        'headers.cookie',
        'headers.x-service-secret',
        'config.database.password',
        'config.aiServiceSecret'
      ],
      censor: '[REDACTED]'
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
