import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabasePool } from './config/database.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { PostgresKnowledgeRepository } from './repositories/postgres-knowledge-repository.js';
import { HttpAiClient } from './services/ai-client.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createDatabasePool(config, logger);
const repository = new PostgresKnowledgeRepository(pool);
const aiClient = new HttpAiClient({
  baseUrl: config.aiServiceUrl,
  secret: config.aiServiceSecret,
  predictionTimeoutMs: config.aiTimeoutMs,
  readinessTimeoutMs: config.aiReadinessTimeoutMs
});
const app = createApp({ config, logger, repository, aiClient });
const server = createServer(app);

server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = config.requestTimeoutMs + 1_000;
server.keepAliveTimeout = 5_000;

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  const forcedExit = setTimeout(() => {
    logger.fatal('Graceful shutdown timed out');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forcedExit.unref();

  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await repository.close().catch((error: unknown) => {
    logger.error({ err: error }, 'Failed to close the database pool cleanly');
    exitCode = 1;
  });
  clearTimeout(forcedExit);
  logger.info('Graceful shutdown completed');
  process.exit(exitCode);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'API listening');
});
