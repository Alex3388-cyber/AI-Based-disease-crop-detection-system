import type { ErrorPresentation } from '../types/api';

export type ApiErrorCode =
  | 'AI_SERVICE_UNAVAILABLE'
  | 'DATABASE_ERROR'
  | 'FILE_TOO_LARGE'
  | 'INTERNAL_ERROR'
  | 'INVALID_IMAGE'
  | 'INVALID_IMAGE_CONTENT'
  | 'INVALID_REQUEST'
  | 'LOW_CONFIDENCE'
  | 'MODEL_NOT_READY'
  | 'NETWORK_ERROR'
  | 'OFFLINE'
  | 'PREDICTION_FAILED'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'SERVICE_BUSY'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'UNKNOWN_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;

  constructor(code: ApiErrorCode, status?: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const ERROR_MESSAGES: Record<ApiErrorCode, ErrorPresentation> = {
  MODEL_NOT_READY: {
    title: 'Detection model is not ready',
    message:
      'The AI model is currently unavailable, so no prediction was made. Please try again later.',
    canRetry: true,
  },
  AI_SERVICE_UNAVAILABLE: {
    title: 'Detection service is unavailable',
    message: 'We could not reach the AI service. Your image was not diagnosed. Please try again shortly.',
    canRetry: true,
  },
  FILE_TOO_LARGE: {
    title: 'Image is too large',
    message: 'Choose a JPEG, PNG, or WEBP image no larger than 8 MB.',
    canRetry: false,
  },
  UNSUPPORTED_FILE_TYPE: {
    title: 'Unsupported image format',
    message: 'Choose a JPEG, PNG, or WEBP image.',
    canRetry: false,
  },
  INVALID_IMAGE:
  {
    title: 'Image could not be used',
    message: 'Choose a clear, valid crop image and try again.',
    canRetry: false,
  },
  INVALID_IMAGE_CONTENT: {
    title: 'Image could not be verified',
    message: 'The file does not appear to contain a valid JPEG, PNG, or WEBP image.',
    canRetry: false,
  },
  INVALID_REQUEST: {
    title: 'Request needs attention',
    message: 'Refresh the crop list, reselect the crop, and try again with the image.',
    canRetry: true,
  },
  LOW_CONFIDENCE: {
    title: 'Prediction is uncertain',
    message: 'Try another clear photo in good light, or ask a qualified agricultural professional.',
    canRetry: true,
  },
  RATE_LIMITED: {
    title: 'Too many requests',
    message: 'Please wait a moment before analyzing another image.',
    canRetry: true,
  },
  SERVICE_BUSY: {
    title: 'Detection service is busy',
    message: 'The service is handling other analyses. Wait a moment, then try again.',
    canRetry: true,
  },
  DATABASE_ERROR: {
    title: 'Disease information is unavailable',
    message: 'The supporting crop information could not be loaded. Please try again later.',
    canRetry: true,
  },
  PREDICTION_FAILED: {
    title: 'Analysis could not be completed',
    message: 'No diagnosis was produced. Check the image and try again.',
    canRetry: true,
  },
  NETWORK_ERROR: {
    title: 'Connection interrupted',
    message: 'Check your internet connection and try again. Server-side detection requires a connection.',
    canRetry: true,
  },
  OFFLINE: {
    title: 'You are offline',
    message: 'Reconnect to the internet to analyze an image. The AI runs securely on the server in Version 1.',
    canRetry: true,
  },
  REQUEST_TIMEOUT: {
    title: 'Analysis took too long',
    message: 'The request timed out before a prediction was returned. Please try again.',
    canRetry: true,
  },
  INTERNAL_ERROR: {
    title: 'Something went wrong',
    message: 'The request could not be completed safely. Please try again later.',
    canRetry: true,
  },
  UNKNOWN_ERROR: {
    title: 'Something went wrong',
    message: 'The request could not be completed. Please try again.',
    canRetry: true,
  },
};

const knownCodes = new Set<ApiErrorCode>(Object.keys(ERROR_MESSAGES) as ApiErrorCode[]);

export function toApiErrorCode(value: unknown, status?: number): ApiErrorCode {
  if (typeof value === 'string' && knownCodes.has(value as ApiErrorCode)) {
    return value as ApiErrorCode;
  }

  if (status === 413) return 'FILE_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_FILE_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status !== undefined && status >= 500) return 'INTERNAL_ERROR';
  return 'UNKNOWN_ERROR';
}

export function presentError(error: unknown): ErrorPresentation {
  if (error instanceof ApiError) return ERROR_MESSAGES[error.code];
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}
