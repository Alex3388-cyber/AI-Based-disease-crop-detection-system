import cors from 'cors';
import type { RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

export function securityHeaders(config: AppConfig): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: config.nodeEnv === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false
  });
}

export function corsAllowlist(config: AppConfig): RequestHandler {
  const allowed = new Set(config.frontendOrigins);
  return cors({
    origin(origin, callback) {
      if (origin === undefined || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError('CORS_NOT_ALLOWED', 'This origin is not allowed to access the API.', 403));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'RateLimit', 'RateLimit-Policy'],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204
  });
}

function createLimiter(config: AppConfig, limit: number): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait before trying again.'
        },
        requestId: String(response.locals.requestId ?? 'unknown')
      });
    }
  });
}

export function generalRateLimiter(config: AppConfig): RequestHandler {
  return createLimiter(config, config.generalRateLimitMax);
}

export function predictionRateLimiter(config: AppConfig): RequestHandler {
  return createLimiter(config, config.predictionRateLimitMax);
}

export function requestTimeout(timeoutMs: number): RequestHandler {
  return (request, response, next) => {
    const controller = new AbortController();
    response.locals.abortSignal = controller.signal;
    const timer = setTimeout(() => {
      controller.abort(new Error('request deadline exceeded'));
    }, timeoutMs);
    timer.unref();

    const abortDisconnected = (): void => {
      if (!response.writableEnded) controller.abort(new Error('client disconnected'));
    };
    const clear = (): void => {
      clearTimeout(timer);
      request.off('aborted', abortDisconnected);
      response.off('close', abortDisconnected);
    };
    request.once('aborted', abortDisconnected);
    response.once('finish', clear);
    response.once('close', abortDisconnected);
    response.once('close', clear);
    next();
  };
}

export function requestAbortSignal(response: Response): AbortSignal {
  const signal = response.locals.abortSignal as unknown;
  if (!(signal instanceof AbortSignal)) {
    throw new AppError('INTERNAL_ERROR', 'Request cancellation was not initialized.', 500);
  }
  return signal;
}

export function throwIfRequestAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AppError('REQUEST_TIMEOUT', 'The request took too long to process.', 503);
  }
}

export class ConcurrencyGate {
  #active = 0;
  readonly #maximum: number;

  public constructor(maximum: number) {
    this.#maximum = maximum;
  }

  public enter(): (() => void) | null {
    if (this.#active >= this.#maximum) return null;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}
