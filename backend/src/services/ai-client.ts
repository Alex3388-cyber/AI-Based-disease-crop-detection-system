import { AppError } from '../errors/app-error.js';
import {
  aiErrorSchema,
  aiPredictionSchema,
  aiReadinessSchema,
  type AiPrediction,
  type AiReadiness
} from '../validators/ai-schemas.js';
import type { ValidatedImage } from './image-validator.js';

export interface AiClient {
  ready(requestId?: string, signal?: AbortSignal): Promise<AiReadiness>;
  predict(image: ValidatedImage, requestId?: string, signal?: AbortSignal): Promise<AiPrediction>;
}

type FetchImplementation = typeof fetch;
const maximumResponseBytes = 64 * 1024;

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maximumResponseBytes) {
    throw new Error('AI service response exceeded the size limit');
  }

  if (response.body === null) throw new Error('AI service returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel();
        throw new Error('AI service response exceeded the size limit');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(body) as unknown;
}

export class HttpAiClient implements AiClient {
  readonly #baseUrl: string;
  readonly #secret: string;
  readonly #predictionTimeoutMs: number;
  readonly #readinessTimeoutMs: number;
  readonly #fetch: FetchImplementation;

  public constructor(options: {
    baseUrl: string;
    secret: string;
    predictionTimeoutMs: number;
    readinessTimeoutMs: number;
    fetchImplementation?: FetchImplementation;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#secret = options.secret;
    this.#predictionTimeoutMs = options.predictionTimeoutMs;
    this.#readinessTimeoutMs = options.readinessTimeoutMs;
    this.#fetch = options.fetchImplementation ?? globalThis.fetch;
  }

  public async ready(requestId?: string, signal?: AbortSignal): Promise<AiReadiness> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}/ready`, {
        method: 'GET',
        headers: {
          'X-Service-Secret': this.#secret,
          Accept: 'application/json',
          ...(requestId === undefined ? {} : { 'X-Request-ID': requestId })
        },
        signal: signal === undefined
          ? AbortSignal.timeout(this.#readinessTimeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(this.#readinessTimeoutMs)])
      });
      const body = await readBoundedJson(response);
      const parsed = aiReadinessSchema.safeParse(body);
      if (!parsed.success) throw new Error('Invalid AI readiness response');
      if (parsed.data.ready && !response.ok) throw new Error('Inconsistent AI readiness response');
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted === true) {
        throw new AppError('REQUEST_TIMEOUT', 'The request took too long to process.', 503);
      }
      throw new AppError(
        'AI_SERVICE_UNAVAILABLE',
        'The disease detection service is currently unavailable.',
        503,
        { cause: error }
      );
    }
  }

  public async predict(
    image: ValidatedImage,
    requestId?: string,
    signal?: AbortSignal
  ): Promise<AiPrediction> {
    const form = new FormData();
    const imageBytes = new ArrayBuffer(image.buffer.byteLength);
    new Uint8Array(imageBytes).set(image.buffer);
    form.append(
      'image',
      new Blob([imageBytes], { type: image.mimeType }),
      `upload.${image.extension}`
    );

    try {
      const response = await this.#fetch(`${this.#baseUrl}/predict`, {
        method: 'POST',
        headers: {
          'X-Service-Secret': this.#secret,
          Accept: 'application/json',
          ...(requestId === undefined ? {} : { 'X-Request-ID': requestId })
        },
        body: form,
        signal: signal === undefined
          ? AbortSignal.timeout(this.#predictionTimeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(this.#predictionTimeoutMs)])
      });
      const body = await readBoundedJson(response);

      if (!response.ok) {
        const serviceError = aiErrorSchema.safeParse(body);
        if (serviceError.success && serviceError.data.error.code === 'MODEL_NOT_READY') {
          throw new AppError(
            'MODEL_NOT_READY',
            'The disease detection model is currently unavailable.',
            503
          );
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          (serviceError.success &&
            ['UNAUTHORIZED', 'SERVICE_NOT_CONFIGURED'].includes(serviceError.data.error.code))
        ) {
          throw new AppError(
            'AI_SERVICE_UNAVAILABLE',
            'The disease detection service is currently unavailable.',
            503
          );
        }
        if (
          response.status === 429 ||
          (serviceError.success && serviceError.data.error.code === 'SERVICE_BUSY')
        ) {
          throw new AppError(
            'SERVICE_BUSY',
            'The disease detection service is busy. Please try again shortly.',
            503
          );
        }
        if (serviceError.success && serviceError.data.error.code === 'PREDICTION_FAILED') {
          throw new AppError(
            'PREDICTION_FAILED',
            'The disease detection service could not produce a valid prediction.',
            502
          );
        }
        throw new AppError(
          response.status >= 500 ? 'AI_SERVICE_UNAVAILABLE' : 'PREDICTION_FAILED',
          response.status >= 500
            ? 'The disease detection service is currently unavailable.'
            : 'The disease detection service could not process the image.',
          response.status >= 500 ? 503 : 502
        );
      }

      const prediction = aiPredictionSchema.safeParse(body);
      if (!prediction.success) {
        throw new AppError(
          'PREDICTION_FAILED',
          'The disease detection service returned an invalid response.',
          502
        );
      }
      return prediction.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted === true) {
        throw new AppError('REQUEST_TIMEOUT', 'The request took too long to process.', 503);
      }
      throw new AppError(
        'AI_SERVICE_UNAVAILABLE',
        'The disease detection service is currently unavailable.',
        503,
        { cause: error }
      );
    }
  }
}
