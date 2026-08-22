import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

const safeRequestId = /^[A-Za-z0-9_-]{1,64}$/;

export function requestContext(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const suppliedId = request.header('x-request-id');
    const requestId = suppliedId !== undefined && safeRequestId.test(suppliedId)
      ? suppliedId
      : randomUUID();
    const startedAt = process.hrtime.bigint();

    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info(
        {
          requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          statusCode: response.statusCode,
          durationMs: Number(durationMs.toFixed(2))
        },
        'HTTP request completed'
      );
    });

    next();
  };
}
