import pino from 'pino';
import { vi } from 'vitest';
import type { AppConfig } from '../src/config/env.js';
import type {
  Crop,
  Disease,
  KnowledgeRepository
} from '../src/repositories/types.js';
import type { AiClient } from '../src/services/ai-client.js';
import { classSetDigest } from '../src/services/class-set-digest.js';

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  frontendOrigins: ['http://localhost:5173'],
  database: {
    host: 'localhost',
    port: 5432,
    database: 'test',
    user: 'test',
    password: 'not-a-real-password',
    ssl: false,
    maxConnections: 2
  },
  aiServiceUrl: 'http://127.0.0.1:5000',
  aiServiceSecret: 'test-service-secret-value',
  aiTimeoutMs: 1_000,
  aiReadinessTimeoutMs: 500,
  maxUploadBytes: 8 * 1024 * 1024,
  minImageDimension: 16,
  maxImageDimension: 8_000,
  maxImagePixels: 25_000_000,
  confidenceThreshold: 0.7,
  generalRateLimitMax: 1_000,
  predictionRateLimitMax: 100,
  rateLimitWindowMs: 60_000,
  maxConcurrentPredictions: 2,
  requestTimeoutMs: 5_000,
  shutdownTimeoutMs: 1_000,
  trustProxy: false,
  logLevel: 'silent'
};

export const cropFixture: Crop = {
  id: '1',
  name: 'Maize',
  scientificName: 'Zea mays',
  description: 'A crop description.',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

export const diseaseFixture: Disease = {
  id: '10',
  cropId: '1',
  cropName: 'Maize',
  cropScientificName: 'Zea mays',
  modelLabel: 'maize_leaf_blight',
  diseaseName: 'Leaf blight',
  description: 'Reviewed description.',
  symptoms: 'Reviewed symptoms.',
  management: 'Reviewed management.',
  prevention: 'Reviewed prevention.',
  sourceReference: 'https://example.edu/reference',
  contentStatus: 'validated',
  reviewedAt: '2026-01-01T00:00:00.000Z',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

export function createRepository(
  overrides: Partial<KnowledgeRepository> = {}
): KnowledgeRepository {
  return {
    ping: vi.fn(async () => undefined),
    listActiveModelLabels: vi.fn(async () => [diseaseFixture.modelLabel]),
    listCrops: vi.fn(async () => ({ items: [cropFixture], total: 1 })),
    findCropById: vi.fn(async () => cropFixture),
    listDiseases: vi.fn(async () => ({ items: [diseaseFixture], total: 1 })),
    findDiseaseById: vi.fn(async () => diseaseFixture),
    findDiseaseByModelLabel: vi.fn(async () => diseaseFixture),
    recordPrediction: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides
  };
}

export function createAiClient(overrides: Partial<AiClient> = {}): AiClient {
  return {
    ready: vi.fn(async () => ({
      ready: true as const,
      modelVersion: 'test-1.0.0',
      classSetDigest: classSetDigest([diseaseFixture.modelLabel])
    })),
    predict: vi.fn(async () => ({
      modelLabel: 'maize_leaf_blight',
      confidence: 0.91,
      modelVersion: 'test-1.0.0',
      uncertain: false
    })),
    ...overrides
  };
}

export const silentLogger = pino({ level: 'silent' });
