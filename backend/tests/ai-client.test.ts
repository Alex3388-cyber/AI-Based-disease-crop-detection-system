import { describe, expect, it, vi } from 'vitest';
import { HttpAiClient } from '../src/services/ai-client.js';
import type { ValidatedImage } from '../src/services/image-validator.js';

const image: ValidatedImage = {
  buffer: Buffer.from('verified-image-bytes'),
  format: 'png',
  mimeType: 'image/png',
  extension: 'png',
  width: 64,
  height: 64
};

function clientWith(fetchImplementation: typeof fetch): HttpAiClient {
  return new HttpAiClient({
    baseUrl: 'http://ai.internal:5000',
    secret: 'service-secret-test-value',
    predictionTimeoutMs: 1_000,
    readinessTimeoutMs: 500,
    fetchImplementation
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('HttpAiClient', () => {
  it('authenticates readiness and validates ready state', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-service-secret')).toBe('service-secret-test-value');
      expect(new Headers(init?.headers).get('x-request-id')).toBe('node-request-id');
      return jsonResponse({
        ready: true,
        modelVersion: '1.0.0',
        classSetDigest: 'a'.repeat(64)
      });
    }) as unknown as typeof fetch;
    await expect(clientWith(fetchMock).ready('node-request-id')).resolves.toEqual({
      ready: true,
      modelVersion: '1.0.0',
      classSetDigest: 'a'.repeat(64)
    });
  });

  it('preserves the explicit safe MODEL_NOT_READY readiness state', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(
      { ready: false, reason: 'MODEL_NOT_READY' },
      { status: 503 }
    )) as unknown as typeof fetch;
    await expect(clientWith(fetchMock).ready()).resolves.toEqual({
      ready: false,
      reason: 'MODEL_NOT_READY'
    });
  });

  it('sends only the verified image under a controlled filename and validates output', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-service-secret')).toBe('service-secret-test-value');
      expect(new Headers(init?.headers).get('x-request-id')).toBe('node-request-id');
      expect(init?.body).toBeInstanceOf(FormData);
      const file = (init?.body as FormData).get('image');
      expect(file).toBeInstanceOf(Blob);
      expect((file as File).name).toBe('upload.png');
      return jsonResponse({
        modelLabel: 'maize_leaf_blight',
        confidence: 0.8,
        modelVersion: '1.0.0',
        uncertain: false
      });
    }) as unknown as typeof fetch;

    await expect(clientWith(fetchMock).predict(image, 'node-request-id')).resolves.toMatchObject({
      modelLabel: 'maize_leaf_blight',
      confidence: 0.8
    });
  });

  it('rejects malformed or additional fields in successful AI responses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      modelLabel: "x' OR 1=1",
      confidence: 4,
      modelVersion: '1.0.0',
      uncertain: false,
      internalPath: '/models/private.keras'
    })) as unknown as typeof fetch;
    await expect(clientWith(fetchMock).predict(image)).rejects.toMatchObject({
      code: 'PREDICTION_FAILED',
      statusCode: 502
    });
  });

  it('maps an authenticated service MODEL_NOT_READY response exactly', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: { code: 'MODEL_NOT_READY', message: 'not loaded' },
      requestId: 'ai-request-id'
    }, { status: 503 })) as unknown as typeof fetch;
    await expect(clientWith(fetchMock).predict(image)).rejects.toMatchObject({
      code: 'MODEL_NOT_READY',
      statusCode: 503
    });
  });

  it('maps invalid credentials and network failures without exposing details', async () => {
    const unauthorized = vi.fn(async () => jsonResponse({
      error: { code: 'UNAUTHORIZED', message: 'bad credential' },
      requestId: 'ai-request-id'
    }, { status: 401 })) as unknown as typeof fetch;
    await expect(clientWith(unauthorized).predict(image)).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
      statusCode: 503
    });

    const unavailable = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.9');
    }) as unknown as typeof fetch;
    const rejection = await clientWith(unavailable).predict(image).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE' });
    expect((rejection as Error).message).not.toContain('10.0.0.9');
  });

  it('preserves inference overload and invalid-output error classes', async () => {
    const busy = vi.fn(async () => jsonResponse({
      error: { code: 'SERVICE_BUSY', message: 'busy' },
      requestId: 'ai-request-id'
    }, { status: 429 })) as unknown as typeof fetch;
    await expect(clientWith(busy).predict(image)).rejects.toMatchObject({
      code: 'SERVICE_BUSY',
      statusCode: 503
    });

    const invalidOutput = vi.fn(async () => jsonResponse({
      error: { code: 'PREDICTION_FAILED', message: 'invalid output' },
      requestId: 'ai-request-id'
    }, { status: 500 })) as unknown as typeof fetch;
    await expect(clientWith(invalidOutput).predict(image)).rejects.toMatchObject({
      code: 'PREDICTION_FAILED',
      statusCode: 502
    });
  });

  it('rejects oversized AI responses', async () => {
    const fetchMock = vi.fn(async () => new Response('x'.repeat(70_000), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
    await expect(clientWith(fetchMock).predict(image)).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE'
    });
  });
});
