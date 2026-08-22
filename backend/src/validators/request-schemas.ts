import { z } from 'zod';

const positiveId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/, 'must be a positive integer identifier')
  .refine((value) => {
    try {
      return BigInt(value) <= 9_223_372_036_854_775_807n;
    } catch {
      return false;
    }
  }, 'identifier is too large');

const limit = z
  .string()
  .default('50')
  .refine((value) => /^\d+$/.test(value), 'must be an integer')
  .transform(Number)
  .refine((value) => value >= 1 && value <= 100, 'must be between 1 and 100');

const offset = z
  .string()
  .default('0')
  .refine((value) => /^\d+$/.test(value), 'must be an integer')
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 0, 'must be a non-negative integer');

const search = z.string().trim().min(1).max(100).optional();

export const cropListQuerySchema = z.object({ limit, offset, search }).strict();

export const diseaseListQuerySchema = z
  .object({
    limit,
    offset,
    search,
    cropId: positiveId.optional()
  })
  .strict();

export const cropIdParamsSchema = z.object({ cropId: positiveId }).strict();
export const diseaseIdParamsSchema = z.object({ diseaseId: positiveId }).strict();

export const predictionFieldsSchema = z.object({ cropId: positiveId.optional() }).strict();

export type CropListQuery = z.infer<typeof cropListQuerySchema>;
export type DiseaseListQuery = z.infer<typeof diseaseListQuerySchema>;
export type PredictionFields = z.infer<typeof predictionFieldsSchema>;
