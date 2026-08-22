import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  ConcurrencyGate,
  predictionRateLimiter,
  requestAbortSignal,
  throwIfRequestAborted
} from '../middleware/security.js';
import type { Crop, Disease, KnowledgeRepository } from '../repositories/types.js';
import type { AiClient } from '../services/ai-client.js';
import { classSetDigest } from '../services/class-set-digest.js';
import { validateImage } from '../services/image-validator.js';
import {
  cropIdParamsSchema,
  cropListQuerySchema,
  diseaseIdParamsSchema,
  diseaseListQuerySchema,
  predictionFieldsSchema
} from '../validators/request-schemas.js';

export interface ApiDependencies {
  config: AppConfig;
  repository: KnowledgeRepository;
  aiClient: AiClient;
  logger: Logger;
}

const paginationOnlySchema = cropListQuerySchema;
const emptyObjectSchema = z.object({}).strict();

function invalidRequest(): AppError {
  return new AppError('INVALID_REQUEST', 'The request parameters are invalid.', 400);
}

async function requestCall<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  throwIfRequestAborted(signal);
  try {
    const result = await operation();
    throwIfRequestAborted(signal);
    return result;
  } catch (error) {
    throwIfRequestAborted(signal);
    throw error;
  }
}

async function databaseCall<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  try {
    return await requestCall(signal, operation);
  } catch (error) {
    throwIfRequestAborted(signal);
    throw new AppError('DATABASE_ERROR', 'The application database is currently unavailable.', 503, {
      cause: error
    });
  }
}

function publicDisease(
  disease: Disease
): Omit<Disease, 'contentStatus'> & { contentValidated: boolean } {
  const { contentStatus, ...rest } = disease;
  const validated = contentStatus === 'validated';
  const safePending = 'Recommendation pending expert/source validation.';
  return {
    ...rest,
    description: validated
      ? disease.description
      : 'Disease information pending expert/source validation.',
    symptoms: validated
      ? disease.symptoms
      : 'Symptom information pending expert/source validation.',
    management: validated ? disease.management : safePending,
    prevention: validated ? disease.prevention : safePending,
    sourceReference: validated ? disease.sourceReference : 'Source pending expert validation.',
    contentValidated: validated
  };
}

const noStore: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
};

export function createApiRouter(dependencies: ApiDependencies): Router {
  const { config, repository, aiClient, logger } = dependencies;
  const router = Router();
  const gate = new ConcurrencyGate(config.maxConcurrentPredictions);
  const upload = multer({
    storage: multer.memoryStorage(),
    preservePath: true,
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 1,
      // Busboy signals its parts limit as soon as the boundary after the last
      // permitted part is observed, so allow that terminal boundary explicitly.
      parts: 3,
      fieldNameSize: 50,
      fieldSize: 64
    }
  });

  router.get('/health', (request, response) => {
    if (!emptyObjectSchema.safeParse(request.query).success) throw invalidRequest();
    response.status(200).json({
      success: true,
      status: 'alive',
      timestamp: new Date().toISOString(),
      requestId: String(response.locals.requestId)
    });
  });

  router.get('/ready', asyncHandler(async (request, response) => {
    if (!emptyObjectSchema.safeParse(request.query).success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const [databaseResult, catalogResult, aiResult] = await Promise.allSettled([
      requestCall(signal, () => repository.ping()),
      requestCall(signal, () => repository.listActiveModelLabels()),
      requestCall(signal, () => aiClient.ready(String(response.locals.requestId), signal))
    ]);
    throwIfRequestAborted(signal);

    const databaseReady =
      databaseResult.status === 'fulfilled' && catalogResult.status === 'fulfilled';
    const aiReadyState = aiResult.status === 'fulfilled' ? aiResult.value : null;
    const aiReachable = aiReadyState !== null;
    const modelReady = aiReadyState?.ready === true;
    const catalogAligned =
      modelReady &&
      catalogResult.status === 'fulfilled' &&
      classSetDigest(catalogResult.value) === aiReadyState.classSetDigest;
    const checks = {
      database: { ready: databaseReady },
      aiService: { reachable: aiReachable, modelReady, catalogAligned }
    };

    if (databaseReady && aiReadyState?.ready === true && catalogAligned) {
      response.status(200).json({
        success: true,
        status: 'ready',
        checks,
        modelVersion: aiReadyState.modelVersion,
        requestId: String(response.locals.requestId)
      });
      return;
    }

    let code: 'DATABASE_ERROR' | 'AI_SERVICE_UNAVAILABLE' | 'MODEL_NOT_READY';
    let message: string;
    if (!databaseReady) {
      code = 'DATABASE_ERROR';
      message = 'The application database is currently unavailable.';
    } else if (!aiReachable) {
      code = 'AI_SERVICE_UNAVAILABLE';
      message = 'The disease detection service is currently unavailable.';
    } else if (!modelReady) {
      code = 'MODEL_NOT_READY';
      message = 'The disease detection model is currently unavailable.';
    } else {
      code = 'MODEL_NOT_READY';
      message = 'The deployed model and disease catalog are not aligned.';
    }

    logger.warn({
      requestId: response.locals.requestId,
      code,
      databaseReady,
      aiReachable,
      modelReady,
      catalogAligned
    }, 'Readiness check degraded');
    response.status(503).json({
      success: false,
      status: 'degraded',
      checks,
      error: { code, message },
      requestId: String(response.locals.requestId)
    });
  }));

  router.get('/crops', asyncHandler(async (request, response) => {
    const query = cropListQuerySchema.safeParse(request.query);
    if (!query.success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const page = await databaseCall(signal, () => repository.listCrops(query.data));
    response.status(200).json({
      success: true,
      data: page.items,
      pagination: { total: page.total, limit: query.data.limit, offset: query.data.offset },
      requestId: String(response.locals.requestId)
    });
  }));

  router.get('/crops/:cropId', asyncHandler(async (request, response) => {
    const params = cropIdParamsSchema.safeParse(request.params);
    const query = emptyObjectSchema.safeParse(request.query);
    if (!params.success || !query.success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const crop = await databaseCall(signal, () => repository.findCropById(params.data.cropId));
    if (crop === null) throw new AppError('NOT_FOUND', 'The requested crop was not found.', 404);
    response.status(200).json({
      success: true,
      data: crop,
      requestId: String(response.locals.requestId)
    });
  }));

  router.get('/crops/:cropId/diseases', asyncHandler(async (request, response) => {
    const params = cropIdParamsSchema.safeParse(request.params);
    const query = paginationOnlySchema.safeParse(request.query);
    if (!params.success || !query.success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const crop = await databaseCall(signal, () => repository.findCropById(params.data.cropId));
    if (crop === null) throw new AppError('NOT_FOUND', 'The requested crop was not found.', 404);
    const page = await databaseCall(signal, () => repository.listDiseases({
      ...query.data,
      cropId: params.data.cropId
    }));
    response.status(200).json({
      success: true,
      data: page.items.map(publicDisease),
      pagination: { total: page.total, limit: query.data.limit, offset: query.data.offset },
      requestId: String(response.locals.requestId)
    });
  }));

  router.get('/diseases', asyncHandler(async (request, response) => {
    const query = diseaseListQuerySchema.safeParse(request.query);
    if (!query.success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const page = await databaseCall(signal, () => repository.listDiseases(query.data));
    response.status(200).json({
      success: true,
      data: page.items.map(publicDisease),
      pagination: { total: page.total, limit: query.data.limit, offset: query.data.offset },
      requestId: String(response.locals.requestId)
    });
  }));

  router.get('/diseases/:diseaseId', asyncHandler(async (request, response) => {
    const params = diseaseIdParamsSchema.safeParse(request.params);
    const query = emptyObjectSchema.safeParse(request.query);
    if (!params.success || !query.success) throw invalidRequest();
    const signal = requestAbortSignal(response);
    const disease = await databaseCall(signal, () => repository.findDiseaseById(params.data.diseaseId));
    if (disease === null) throw new AppError('NOT_FOUND', 'The requested disease was not found.', 404);
    response.status(200).json({
      success: true,
      data: publicDisease(disease),
      requestId: String(response.locals.requestId)
    });
  }));

  router.post(
    '/predict',
    noStore,
    predictionRateLimiter(config),
    upload.single('image'),
    asyncHandler(async (request, response) => {
      if (!emptyObjectSchema.safeParse(request.query).success) throw invalidRequest();
      if (request.file === undefined) {
        throw new AppError('INVALID_IMAGE', 'An image file is required.', 400);
      }
      const fields = predictionFieldsSchema.safeParse(request.body);
      if (!fields.success) throw invalidRequest();

      const release = gate.enter();
      if (release === null) {
        throw new AppError(
          'SERVICE_BUSY',
          'The disease detection service is busy. Please try again shortly.',
          503
        );
      }
      const signal = requestAbortSignal(response);

      try {
        throwIfRequestAborted(signal);

        let selectedCrop: Crop | null = null;
        if (fields.data.cropId !== undefined) {
          selectedCrop = await databaseCall(
            signal,
            () => repository.findCropById(fields.data.cropId!)
          );
          if (selectedCrop === null) {
            throw new AppError('INVALID_REQUEST', 'The selected crop does not exist.', 400);
          }
        }

        const startedAt = process.hrtime.bigint();
        const image = await requestCall(signal, () => validateImage(request.file!, {
          minDimension: config.minImageDimension,
          maxDimension: config.maxImageDimension,
          maxPixels: config.maxImagePixels
        }));
        const aiPrediction = await requestCall(
          signal,
          () => aiClient.predict(image, String(response.locals.requestId), signal)
        );
        const disease = await databaseCall(
          signal,
          () => repository.findDiseaseByModelLabel(aiPrediction.modelLabel)
        );
        if (disease === null) {
          throw new AppError(
            'PREDICTION_FAILED',
            'The predicted class is not configured in the disease knowledge base.',
            502
          );
        }

        const cropMismatch = selectedCrop !== null && selectedCrop.id !== disease.cropId;
        const uncertain =
          aiPrediction.uncertain ||
          aiPrediction.confidence < config.confidenceThreshold ||
          cropMismatch;

        await databaseCall(signal, () => repository.recordPrediction({
          diseaseId: disease.id,
          modelLabel: aiPrediction.modelLabel,
          confidence: aiPrediction.confidence,
          uncertain,
          modelVersion: aiPrediction.modelVersion
        }));

        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        logger.info({
          requestId: response.locals.requestId,
          predictionDurationMs: Number(elapsedMs.toFixed(2)),
          modelVersion: aiPrediction.modelVersion,
          uncertain,
          cropMismatch
        }, 'Prediction completed');

        throwIfRequestAborted(signal);
        const safeDisease = publicDisease(disease);
        response.status(200).json({
          success: true,
          prediction: {
            crop: safeDisease.cropName,
            cropScientificName: safeDisease.cropScientificName,
            disease: safeDisease.diseaseName,
            modelLabel: aiPrediction.modelLabel,
            confidence: aiPrediction.confidence,
            uncertain,
            warning: cropMismatch
              ? 'The detected crop does not match the selected crop. Try another clear image or seek expert advice.'
              : uncertain
                ? 'Low-confidence result. Try another clear image or seek agricultural expert advice.'
                : null,
            description: safeDisease.description,
            symptoms: safeDisease.symptoms,
            management: safeDisease.management,
            prevention: safeDisease.prevention,
            sourceReference: safeDisease.sourceReference,
            contentValidated: safeDisease.contentValidated,
            modelVersion: aiPrediction.modelVersion,
            disclaimer: 'This AI result is preliminary decision support, not a guaranteed diagnosis.'
          },
          requestId: String(response.locals.requestId)
        });
      } finally {
        release();
      }
    })
  );

  return router;
}
