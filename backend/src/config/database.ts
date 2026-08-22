import pg from 'pg';
import type { Logger } from 'pino';
import type { AppConfig } from './env.js';

const { Pool } = pg;

export function createDatabasePool(config: AppConfig, logger: Logger): pg.Pool {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    max: config.database.maxConnections,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    application_name: 'crop-disease-api',
    ssl: config.database.ssl ? { rejectUnauthorized: true } : false
  });

  pool.on('error', (error) => {
    logger.error({ err: error }, 'Unexpected idle PostgreSQL client error');
  });

  return pool;
}
