import type { Crop, Prediction, PredictionRequest, UploadProgress } from '../types/api';
import { ApiError, toApiErrorCode } from '../utils/errors';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const PREDICTION_TIMEOUT_MS = 130_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(record: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function unwrapData(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if ('data' in payload) return payload.data;
  return payload;
}

function extractError(payload: unknown, status?: number): ApiError {
  let code: unknown;
  if (isRecord(payload)) {
    if (isRecord(payload.error)) code = payload.error.code;
    else code = payload.code;
  }
  return new ApiError(toApiErrorCode(code, status), status);
}

function normalizeCrop(value: unknown): Crop | undefined {
  if (!isRecord(value)) return undefined;
  const rawId = value.id ?? value.cropId ?? value.crop_id;
  const name = pickString(value, 'name', 'cropName', 'crop_name');
  if ((typeof rawId !== 'string' && typeof rawId !== 'number') || !name) return undefined;

  return {
    id: String(rawId),
    name,
    scientificName: pickString(value, 'scientificName', 'scientific_name'),
    description: pickString(value, 'description'),
  };
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\r?\n|•/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePrediction(payload: unknown): Prediction {
  let value = unwrapData(payload);
  if (isRecord(value) && 'prediction' in value) value = value.prediction;
  if (!isRecord(value)) throw new ApiError('PREDICTION_FAILED');

  const crop = pickString(value, 'crop', 'cropName', 'crop_name');
  const disease = pickString(value, 'disease', 'diseaseName', 'disease_name');
  const rawConfidence = value.confidence;
  if (!crop || !disease || typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    throw new ApiError('PREDICTION_FAILED');
  }

  const confidence = rawConfidence;
  if (confidence < 0 || confidence > 1) throw new ApiError('PREDICTION_FAILED');

  return {
    crop,
    disease,
    modelLabel: pickString(value, 'modelLabel', 'model_label'),
    confidence,
    uncertain: typeof value.uncertain === 'boolean' ? value.uncertain : true,
    warning: pickString(value, 'warning'),
    description: pickString(value, 'description'),
    symptoms: toStringList(value.symptoms),
    management: toStringList(value.management ?? value.treatment),
    prevention: toStringList(value.prevention),
    sourceReference: pickString(value, 'sourceReference', 'source_reference', 'source'),
    modelVersion: pickString(value, 'modelVersion', 'model_version'),
  };
}

export async function getSupportedCrops(signal?: AbortSignal): Promise<Crop[]> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/crops`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.ok ? 'INTERNAL_ERROR' : toApiErrorCode(undefined, response.status), response.status);
  }

  if (!response.ok || (isRecord(payload) && payload.success === false)) {
    throw extractError(payload, response.status);
  }

  const data = unwrapData(payload);
  const candidates = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.crops)
      ? data.crops
      : isRecord(payload) && Array.isArray(payload.crops)
        ? payload.crops
        : [];

  return candidates.map(normalizeCrop).filter((crop): crop is Crop => Boolean(crop));
}

function parseXhrPayload(xhr: XMLHttpRequest): unknown {
  if (xhr.response && typeof xhr.response === 'object') return xhr.response;
  try {
    if (typeof xhr.responseText !== 'string' || !xhr.responseText) return undefined;
    return JSON.parse(xhr.responseText) as unknown;
  } catch {
    return undefined;
  }
}

export function uploadPrediction(
  request: PredictionRequest,
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<Prediction> {
  if (!navigator.onLine) return Promise.reject(new ApiError('OFFLINE'));
  if (signal?.aborted) return Promise.reject(new DOMException('The request was cancelled.', 'AbortError'));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('image', request.image);
    if (request.cropId) formData.append('cropId', request.cropId);

    const abortRequest = () => xhr.abort();
    signal?.addEventListener('abort', abortRequest, { once: true });

    const cleanUp = () => signal?.removeEventListener('abort', abortRequest);
    xhr.open('POST', `${API_BASE_URL}/api/predict`);
    xhr.responseType = 'json';
    xhr.timeout = PREDICTION_TIMEOUT_MS;
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      const percent = event.lengthComputable ? Math.round((event.loaded / event.total) * 75) : 35;
      onProgress({ percent: Math.max(5, percent), stage: 'uploading' });
    };
    xhr.upload.onload = () => onProgress({ percent: 82, stage: 'analyzing' });

    xhr.onload = () => {
      cleanUp();
      const payload = parseXhrPayload(xhr);
      if (xhr.status < 200 || xhr.status >= 300 || (isRecord(payload) && payload.success === false)) {
        reject(extractError(payload, xhr.status));
        return;
      }
      try {
        onProgress({ percent: 100, stage: 'analyzing' });
        resolve(normalizePrediction(payload));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      cleanUp();
      reject(new ApiError(navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE'));
    };
    xhr.ontimeout = () => {
      cleanUp();
      reject(new ApiError('REQUEST_TIMEOUT'));
    };
    xhr.onabort = () => {
      cleanUp();
      reject(new DOMException('The request was cancelled.', 'AbortError'));
    };

    onProgress({ percent: 5, stage: 'uploading' });
    xhr.send(formData);
  });
}
