import express, { type Express } from 'express';
import type { AppConfig } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import {
  corsAllowlist,
  generalRateLimiter,
  requestTimeout,
  securityHeaders
} from './middleware/security.js';
import type { KnowledgeRepository } from './repositories/types.js';
import { createApiRouter } from './routes/api.js';
import type { AiClient } from './services/ai-client.js';
import type { Logger } from 'pino';

export interface AppDependencies {
  config: AppConfig;
  repository: KnowledgeRepository;
  aiClient: AiClient;
  logger: Logger;
}

export function createApp(dependencies: AppDependencies): Express {
  const { config, logger } = dependencies;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.set('json escape', true);

  app.use(requestContext(logger));
  app.use(securityHeaders(config));
  app.use(corsAllowlist(config));
  app.use(requestTimeout(config.requestTimeoutMs));
  app.use(express.json({ limit: '64kb', strict: true, type: ['application/json', 'application/*+json'] }));

  const router = createApiRouter(dependencies);
  const generalLimiter = generalRateLimiter(config);
  app.use('/api/v1', generalLimiter, router);
  app.use('/api', generalLimiter, router);
  app.use('/', generalLimiter, router);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
