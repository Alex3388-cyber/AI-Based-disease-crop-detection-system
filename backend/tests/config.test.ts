import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  FRONTEND_ORIGINS: 'http://localhost:5173,https://example.test',
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'crop_test',
  DATABASE_USER: 'crop_api',
  DATABASE_PASSWORD: 'test-password',
  AI_SERVICE_URL: 'http://127.0.0.1:5000',
  AI_SERVICE_SECRET: 'test-service-secret',
  AI_TIMEOUT_MS: '1000',
  REQUEST_TIMEOUT_MS: '2000'
};

describe('loadConfig', () => {
  it('parses a valid explicit configuration', () => {
    const config = loadConfig(baseEnvironment);
    expect(config.frontendOrigins).toEqual(['http://localhost:5173', 'https://example.test']);
    expect(config.maxUploadBytes).toBe(8 * 1024 * 1024);
    expect(config.maxImageDimension).toBe(8_192);
    expect(config.database.password).toBe('test-password');
  });

  it('rejects missing service credentials', () => {
    const environment = { ...baseEnvironment };
    delete environment.AI_SERVICE_SECRET;
    expect(() => loadConfig(environment)).toThrow(/AI_SERVICE_SECRET/);
  });

  it('rejects wildcard CORS configuration', () => {
    expect(() => loadConfig({ ...baseEnvironment, FRONTEND_ORIGINS: '*' })).toThrow(
      /cannot use \*/
    );
  });

  it('rejects upload limits above the fixed 8 MB ceiling', () => {
    expect(() => loadConfig({ ...baseEnvironment, MAX_UPLOAD_MB: '9' })).toThrow(/MAX_UPLOAD_MB/);
  });

  it('requires a stronger production service secret', () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      AI_SERVICE_SECRET: 'sixteen-characters'
    })).toThrow(/at least 32 characters/);
  });
});
