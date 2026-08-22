import { z } from 'zod';

export const modelLabelSchema = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

const readySchema = z
  .object({
    ready: z.literal(true),
    modelVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    classSetDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

const notReadySchema = z
  .object({
    ready: z.literal(false),
    reason: z.literal('MODEL_NOT_READY')
  })
  .strict();

export const aiReadinessSchema = z.discriminatedUnion('ready', [readySchema, notReadySchema]);

export const aiPredictionSchema = z
  .object({
    modelLabel: modelLabelSchema,
    confidence: z.number().finite().min(0).max(1),
    modelVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    uncertain: z.boolean()
  })
  .strict();

export const aiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(500)
      })
      .strict(),
    requestId: z.string().min(1).max(128)
  })
  .strict();

export type AiReadiness = z.infer<typeof aiReadinessSchema>;
export type AiPrediction = z.infer<typeof aiPredictionSchema>;
