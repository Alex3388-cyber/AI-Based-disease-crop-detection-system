import { z } from 'zod';

const integerFromString = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const trustProxySchema = z.string().transform((value, context): boolean | number => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0 && hops <= 10) return hops;

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'TRUST_PROXY must be true, false, or a hop count from 0 to 10'
  });
  return z.NEVER;
});

const serviceUrlSchema = z.string().url().transform((value, context) => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AI_SERVICE_URL must use http or https'
    });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AI_SERVICE_URL must not contain credentials, a query, or a fragment'
    });
  }
  return parsed.toString().replace(/\/$/, '');
});

const originsSchema = z.string().transform((value, context) => {
  const candidates = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (candidates.length === 0 || candidates.includes('*')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'FRONTEND_ORIGINS must contain explicit origins and cannot use *'
    });
    return z.NEVER;
  }

  const origins: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate) {
        throw new Error('not an HTTP origin');
      }
      origins.push(parsed.origin);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid frontend origin: ${candidate}`
      });
    }
  }
  return [...new Set(origins)];
});

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: integerFromString(1, 65_535).default(3000),
    FRONTEND_ORIGINS: originsSchema,
    DATABASE_HOST: z.string().min(1),
    DATABASE_PORT: integerFromString(1, 65_535).default(5432),
    DATABASE_NAME: z.string().min(1),
    DATABASE_USER: z.string().min(1),
    DATABASE_PASSWORD: z.string().min(1),
    DATABASE_SSL: booleanFromString.default('false'),
    DATABASE_POOL_MAX: integerFromString(1, 50).default(10),
    AI_SERVICE_URL: serviceUrlSchema,
    AI_SERVICE_SECRET: z.string().min(16),
    AI_TIMEOUT_MS: integerFromString(100, 30_000).default(10_000),
    AI_READINESS_TIMEOUT_MS: integerFromString(100, 10_000).default(2_000),
    MAX_UPLOAD_MB: integerFromString(1, 8).default(8),
    MIN_IMAGE_DIMENSION: integerFromString(1, 512).default(32),
    MAX_IMAGE_DIMENSION: integerFromString(512, 16_384).default(8_192),
    MAX_IMAGE_PIXELS: integerFromString(1_000_000, 40_000_000).default(25_000_000),
    MODEL_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.70),
    GENERAL_RATE_LIMIT_MAX: integerFromString(1, 100_000).default(120),
    PREDICTION_RATE_LIMIT_MAX: integerFromString(1, 10_000).default(10),
    RATE_LIMIT_WINDOW_MS: integerFromString(1_000, 3_600_000).default(60_000),
    MAX_CONCURRENT_PREDICTIONS: integerFromString(1, 100).default(2),
    REQUEST_TIMEOUT_MS: integerFromString(1_000, 120_000).default(15_000),
    SHUTDOWN_TIMEOUT_MS: integerFromString(1_000, 60_000).default(10_000),
    TRUST_PROXY: trustProxySchema.default('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
  })
  .passthrough()
  .superRefine((env, context) => {
    if (env.REQUEST_TIMEOUT_MS <= env.AI_TIMEOUT_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUEST_TIMEOUT_MS'],
        message: 'REQUEST_TIMEOUT_MS must be greater than AI_TIMEOUT_MS'
      });
    }
    if (env.MIN_IMAGE_DIMENSION > env.MAX_IMAGE_DIMENSION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MIN_IMAGE_DIMENSION'],
        message: 'MIN_IMAGE_DIMENSION cannot exceed MAX_IMAGE_DIMENSION'
      });
    }
    if (env.NODE_ENV === 'production' && env.AI_SERVICE_SECRET.length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_SERVICE_SECRET'],
        message: 'AI_SERVICE_SECRET must contain at least 32 characters in production'
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      (/change[_-]?me/i.test(env.AI_SERVICE_SECRET) || /change[_-]?me/i.test(env.DATABASE_PASSWORD))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Placeholder credentials are forbidden in production'
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  frontendOrigins: readonly string[];
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    maxConnections: number;
  };
  aiServiceUrl: string;
  aiServiceSecret: string;
  aiTimeoutMs: number;
  aiReadinessTimeoutMs: number;
  maxUploadBytes: number;
  minImageDimension: number;
  maxImageDimension: number;
  maxImagePixels: number;
  confidenceThreshold: number;
  generalRateLimitMax: number;
  predictionRateLimitMax: number;
  rateLimitWindowMs: number;
  maxConcurrentPredictions: number;
  requestTimeoutMs: number;
  shutdownTimeoutMs: number;
  trustProxy: boolean | number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API configuration: ${issues}`);
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    frontendOrigins: env.FRONTEND_ORIGINS,
    database: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      database: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      ssl: env.DATABASE_SSL,
      maxConnections: env.DATABASE_POOL_MAX
    },
    aiServiceUrl: env.AI_SERVICE_URL,
    aiServiceSecret: env.AI_SERVICE_SECRET,
    aiTimeoutMs: env.AI_TIMEOUT_MS,
    aiReadinessTimeoutMs: env.AI_READINESS_TIMEOUT_MS,
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    minImageDimension: env.MIN_IMAGE_DIMENSION,
    maxImageDimension: env.MAX_IMAGE_DIMENSION,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    confidenceThreshold: env.MODEL_CONFIDENCE_THRESHOLD,
    generalRateLimitMax: env.GENERAL_RATE_LIMIT_MAX,
    predictionRateLimitMax: env.PREDICTION_RATE_LIMIT_MAX,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    maxConcurrentPredictions: env.MAX_CONCURRENT_PREDICTIONS,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    trustProxy: env.TRUST_PROXY,
    logLevel: env.LOG_LEVEL
  };
}
