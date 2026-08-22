import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';
import { AppError, isAppError } from '../errors/app-error.js';

function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError('FILE_TOO_LARGE', 'The image exceeds the upload size limit.', 413, {
        cause: error
      });
    }
    return new AppError('INVALID_IMAGE', 'The image upload request is invalid.', 400, {
      cause: error
    });
  }

  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    return new AppError('INVALID_REQUEST', 'The request body is malformed.', 400, { cause: error });
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.too.large'
  ) {
    return new AppError('INVALID_REQUEST', 'The request body is too large.', 413, { cause: error });
  }

  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', 500, {
    cause: error,
    operational: false
  });
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    const normalized = normalizeError(error);
    const requestId = String(response.locals.requestId ?? 'unknown');
    const causeName = normalized.cause instanceof Error
      ? normalized.cause.name
      : typeof normalized.cause;
    const logPayload = {
      requestId,
      code: normalized.code,
      statusCode: normalized.statusCode,
      causeName
    };

    if (normalized.statusCode >= 500) {
      if (normalized.operational) {
        logger.error(logPayload, 'Request failed');
      } else {
        logger.error({ ...logPayload, err: normalized.cause ?? normalized }, 'Request failed');
      }
    } else {
      logger.warn(logPayload, 'Request rejected');
    }

    if (response.headersSent) return;
    response.setHeader('Cache-Control', 'no-store');
    response.status(normalized.statusCode).json({
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message
      },
      requestId
    });
  };
}

export function notFoundHandler(): RequestHandler {
  return (_request, response) => {
    response.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'The requested API endpoint was not found.' },
      requestId: String(response.locals.requestId ?? 'unknown')
    });
  };
}
