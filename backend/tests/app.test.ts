import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors/app-error.js';
import type { KnowledgeRepository } from '../src/repositories/types.js';
import type { AiClient } from '../src/services/ai-client.js';
import {
  createAiClient,
  createRepository,
  diseaseFixture,
  silentLogger,
  testConfig
} from './helpers.js';

let pngImage: Buffer;

beforeAll(async () => {
  pngImage = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#2f7d32' }
  }).png().toBuffer();
});

function testApp(options: {
  repository?: KnowledgeRepository;
  aiClient?: AiClient;
  config?: typeof testConfig;
} = {}) {
  return createApp({
    config: options.config ?? testConfig,
    repository: options.repository ?? createRepository(),
    aiClient: options.aiClient ?? createAiClient(),
    logger: silentLogger
  });
}

describe('API liveness, readiness, and security middleware', () => {
  it('reports process liveness without claiming dependency readiness', async () => {
    const response = await request(testApp()).get('/api/v1/health').expect(200);
    expect(response.body.status).toBe('alive');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('preserves only a syntactically safe caller request ID', async () => {
    const accepted = await request(testApp())
      .get('/health')
      .set('X-Request-ID', 'demo_request-123')
      .expect(200);
    expect(accepted.headers['x-request-id']).toBe('demo_request-123');

    const rejected = await request(testApp())
      .get('/health')
      .set('X-Request-ID', 'x'.repeat(100))
      .expect(200);
    expect(rejected.headers['x-request-id']).not.toBe('x'.repeat(100));
  });

  it('allows configured browser origins and rejects other origins', async () => {
    const allowed = await request(testApp())
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(testApp())
      .get('/health')
      .set('Origin', 'https://attacker.invalid')
      .expect(403);
    expect(denied.body.error.code).toBe('CORS_NOT_ALLOWED');
    expect(denied.text).not.toContain('attacker.invalid');
  });

  it('reports ready only when the database and actual model are ready', async () => {
    const response = await request(testApp()).get('/ready').expect(200);
    expect(response.body).toMatchObject({
      success: true,
      status: 'ready',
      checks: { database: { ready: true }, aiService: { reachable: true, modelReady: true } }
    });
  });

  it('returns MODEL_NOT_READY safely when the AI process has no model', async () => {
    const aiClient = createAiClient({
      ready: vi.fn(async () => ({ ready: false as const, reason: 'MODEL_NOT_READY' as const }))
    });
    const response = await request(testApp({ aiClient })).get('/ready').expect(503);
    expect(response.body.error.code).toBe('MODEL_NOT_READY');
    expect(response.body.checks.aiService).toEqual({
      reachable: true,
      modelReady: false,
      catalogAligned: false
    });
  });

  it('stays degraded when model classes and active catalog mappings differ', async () => {
    const repository = createRepository({
      listActiveModelLabels: vi.fn(async () => ['different_active_label'])
    });

    const response = await request(testApp({ repository })).get('/ready').expect(503);

    expect(response.body.error.code).toBe('MODEL_NOT_READY');
    expect(response.body.checks.aiService).toMatchObject({
      reachable: true,
      modelReady: true,
      catalogAligned: false
    });
  });

  it('distinguishes an unreachable AI service from an unloaded model', async () => {
    const aiClient = createAiClient({ ready: vi.fn(async () => { throw new Error('private host'); }) });
    const response = await request(testApp({ aiClient })).get('/ready').expect(503);
    expect(response.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
    expect(response.text).not.toContain('private host');
  });

  it('sanitizes database readiness failures', async () => {
    const repository = createRepository({
      ping: vi.fn(async () => { throw new Error('password=top-secret host=10.0.0.8'); })
    });
    const response = await request(testApp({ repository })).get('/ready').expect(503);
    expect(response.body.error.code).toBe('DATABASE_ERROR');
    expect(response.text).not.toContain('top-secret');
    expect(response.text).not.toContain('10.0.0.8');
  });
});

describe('crop and disease endpoints', () => {
  it('returns paginated crops and validates every query key', async () => {
    const repository = createRepository();
    const response = await request(testApp({ repository }))
      .get('/api/crops?limit=10&offset=0&search=mai')
      .expect(200);
    expect(response.body.data[0].name).toBe('Maize');
    expect(repository.listCrops).toHaveBeenCalledWith({ limit: 10, offset: 0, search: 'mai' });

    const invalid = await request(testApp()).get('/api/v1/crops?admin=true').expect(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');
  });

  it('passes SQL-injection-like search text only as repository data', async () => {
    const repository = createRepository();
    await request(testApp({ repository }))
      .get('/api/v1/crops')
      .query({ search: "%' OR 1=1 --" })
      .expect(200);
    expect(repository.listCrops).toHaveBeenCalledWith(expect.objectContaining({
      search: "%' OR 1=1 --"
    }));
  });

  it('masks agricultural guidance that has not been source-validated', async () => {
    const pending = {
      ...diseaseFixture,
      contentStatus: 'pending' as const,
      management: 'Unreviewed chemical instruction',
      sourceReference: null
    };
    const repository = createRepository({
      listDiseases: vi.fn(async () => ({ items: [pending], total: 1 }))
    });
    const response = await request(testApp({ repository })).get('/api/v1/diseases').expect(200);
    expect(response.body.data[0].contentValidated).toBe(false);
    expect(response.body.data[0].management).toBe(
      'Recommendation pending expert/source validation.'
    );
    expect(response.text).not.toContain('Unreviewed chemical instruction');
  });

  it('escapes HTML-significant characters in JSON output', async () => {
    const repository = createRepository({
      listCrops: vi.fn(async () => ({
        items: [{
          id: '2',
          name: '<script>alert(1)</script>',
          scientificName: null,
          description: '& unsafe',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }],
        total: 1
      }))
    });
    const response = await request(testApp({ repository })).get('/api/v1/crops').expect(200);
    expect(response.text).not.toContain('<script>');
    expect(response.text).toContain('\\u003cscript\\u003e');
  });

  it('maps database query failures to DATABASE_ERROR without internals', async () => {
    const repository = createRepository({
      listCrops: vi.fn(async () => { throw new Error('relation crops missing at /srv/db.ts'); })
    });
    const response = await request(testApp({ repository })).get('/api/v1/crops').expect(503);
    expect(response.body.error.code).toBe('DATABASE_ERROR');
    expect(response.text).not.toContain('relation crops');
    expect(response.text).not.toContain('/srv');
  });

  it('returns safe 400 and 404 responses for invalid and absent identifiers', async () => {
    const invalid = await request(testApp()).get('/api/v1/diseases/1%20OR%201=1').expect(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');

    const repository = createRepository({ findDiseaseById: vi.fn(async () => null) });
    const absent = await request(testApp({ repository })).get('/api/v1/diseases/999').expect(404);
    expect(absent.body.error.code).toBe('NOT_FOUND');
  });
});

describe('prediction endpoint', () => {
  it('keeps the concurrency slot until timed-out work actually stops', async () => {
    const repository = createRepository();
    const aiClient = createAiClient({
      predict: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          modelLabel: 'maize_leaf_blight',
          confidence: 0.91,
          modelVersion: 'test-1.0.0',
          uncertain: false
        };
      })
    });
    const config = {
      ...testConfig,
      requestTimeoutMs: 25,
      maxConcurrentPredictions: 1
    };
    const app = testApp({ repository, aiClient, config });

    const first = request(app)
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const busy = await request(app)
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(503);
    const timedOut = await first;

    expect(busy.body.error.code).toBe('SERVICE_BUSY');
    expect(timedOut.status).toBe(503);
    expect(timedOut.body.error.code).toBe('REQUEST_TIMEOUT');
    expect(repository.recordPrediction).not.toHaveBeenCalled();
  });

  it('validates, proxies, enriches, and anonymously records a real AI response', async () => {
    const repository = createRepository();
    const aiClient = createAiClient();
    const response = await request(testApp({ repository, aiClient }))
      .post('/api/v1/predict')
      .field('cropId', '1')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(200);

    expect(aiClient.predict).toHaveBeenCalledOnce();
    expect(repository.recordPrediction).toHaveBeenCalledWith({
      diseaseId: '10',
      modelLabel: 'maize_leaf_blight',
      confidence: 0.91,
      uncertain: false,
      modelVersion: 'test-1.0.0'
    });
    expect(response.body.prediction).toMatchObject({
      crop: 'Maize',
      disease: 'Leaf blight',
      confidence: 0.91,
      uncertain: false,
      contentValidated: true
    });
    expect(response.body.prediction.disclaimer).toContain('not a guaranteed diagnosis');
  });

  it('marks low confidence and selected-crop mismatches as uncertain', async () => {
    const aiClient = createAiClient({
      predict: vi.fn(async () => ({
        modelLabel: 'maize_leaf_blight',
        confidence: 0.4,
        modelVersion: 'test-1.0.0',
        uncertain: false
      }))
    });
    const response = await request(testApp({ aiClient }))
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(200);
    expect(response.body.prediction.uncertain).toBe(true);
    expect(response.body.prediction.warning).toContain('Low-confidence');
  });

  it('does not turn MODEL_NOT_READY into a fabricated prediction', async () => {
    const aiClient = createAiClient({
      predict: vi.fn(async () => {
        throw new AppError(
          'MODEL_NOT_READY',
          'The disease detection model is currently unavailable.',
          503
        );
      })
    });
    const repository = createRepository();
    const response = await request(testApp({ aiClient, repository }))
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(503);
    expect(response.body.error.code).toBe('MODEL_NOT_READY');
    expect(repository.recordPrediction).not.toHaveBeenCalled();
  });

  it('returns AI_SERVICE_UNAVAILABLE without network details', async () => {
    const aiClient = createAiClient({
      predict: vi.fn(async () => {
        throw new AppError(
          'AI_SERVICE_UNAVAILABLE',
          'The disease detection service is currently unavailable.',
          503,
          { cause: new Error('connect ECONNREFUSED 10.0.0.9:5000') }
        );
      })
    });
    const response = await request(testApp({ aiClient }))
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(503);
    expect(response.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
    expect(response.text).not.toContain('10.0.0.9');
  });

  it('rejects unknown model labels and does not persist them', async () => {
    const repository = createRepository({
      findDiseaseByModelLabel: vi.fn(async () => null)
    });
    const response = await request(testApp({ repository }))
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(502);
    expect(response.body.error.code).toBe('PREDICTION_FAILED');
    expect(repository.recordPrediction).not.toHaveBeenCalled();
  });

  it('maps prediction-record database failures safely', async () => {
    const repository = createRepository({
      recordPrediction: vi.fn(async () => { throw new Error('password=secret'); })
    });
    const response = await request(testApp({ repository }))
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(503);
    expect(response.body.error.code).toBe('DATABASE_ERROR');
    expect(response.text).not.toContain('password');
  });

  it('rejects missing, double-extension, spoofed-MIME, and fake image uploads', async () => {
    const app = testApp();
    expect((await request(app).post('/predict').expect(400)).body.error.code).toBe('INVALID_IMAGE');

    expect((await request(app)
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png.php', contentType: 'image/png' })
      .expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    expect((await request(app)
      .post('/predict')
      .attach('image', pngImage, { filename: 'leaf.png', contentType: 'text/plain' })
      .expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    expect((await request(app)
      .post('/predict')
      .attach('image', Buffer.from('this is not a jpeg'), {
        filename: 'leaf.jpg',
        contentType: 'image/jpeg'
      })
      .expect(422)).body.error.code).toBe('INVALID_IMAGE_CONTENT');
  });

  it('rejects malformed signature-bearing images after full decode', async () => {
    const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const response = await request(testApp())
      .post('/predict')
      .attach('image', corruptJpeg, { filename: 'leaf.jpg', contentType: 'image/jpeg' })
      .expect(422);
    expect(response.body.error.code).toBe('INVALID_IMAGE_CONTENT');
  });

  it('enforces the multipart byte limit before decoding', async () => {
    const config = { ...testConfig, maxUploadBytes: 1_024 };
    const response = await request(testApp({ config }))
      .post('/predict')
      .attach('image', Buffer.alloc(1_025, 1), { filename: 'large.png', contentType: 'image/png' })
      .expect(413);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('handles malformed JSON safely', async () => {
    const response = await request(testApp())
      .post('/predict')
      .set('Content-Type', 'application/json')
      .send('{"cropId":')
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rate-limits excessive inference requests', async () => {
    const config = { ...testConfig, predictionRateLimitMax: 2 };
    const app = testApp({ config });
    await request(app).post('/predict').expect(400);
    await request(app).post('/predict').expect(400);
    const response = await request(app).post('/predict').expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('fallback handling', () => {
  it('returns a consistent JSON 404 without stack traces', async () => {
    const response = await request(testApp()).get('/api/v1/not-real').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.text).not.toContain('Error:');
  });
});
