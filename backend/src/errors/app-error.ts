export type PublicErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_IMAGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE_CONTENT'
  | 'MODEL_NOT_READY'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'PREDICTION_FAILED'
  | 'DATABASE_ERROR'
  | 'RATE_LIMITED'
  | 'SERVICE_BUSY'
  | 'REQUEST_TIMEOUT'
  | 'CORS_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly code: PublicErrorCode;
  public readonly statusCode: number;
  public readonly operational: boolean;

  public constructor(
    code: PublicErrorCode,
    message: string,
    statusCode: number,
    options?: { cause?: unknown; operational?: boolean }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.operational = options?.operational ?? true;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
