import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type {
  Crop,
  Disease,
  DiseaseListOptions,
  KnowledgeRepository,
  ListOptions,
  Page,
  PredictionRecord
} from './types.js';

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

interface CropRow extends QueryResultRow {
  id: string | null;
  name: string;
  scientificName: string | null;
  description: string;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  totalCount?: string;
}

interface DiseaseRow extends QueryResultRow {
  id: string | null;
  cropId: string;
  cropName: string;
  cropScientificName: string | null;
  modelLabel: string;
  diseaseName: string;
  description: string;
  symptoms: string;
  management: string;
  prevention: string;
  sourceReference: string | null;
  contentStatus: 'pending' | 'validated' | 'retired';
  reviewedAt: Date | string | null;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  totalCount?: string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCrop(row: CropRow): Crop {
  if (row.id === null) throw new Error('Cannot map an empty crop page sentinel');
  return {
    id: row.id,
    name: row.name,
    scientificName: row.scientificName,
    description: row.description,
    active: row.active,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapDisease(row: DiseaseRow): Disease {
  if (row.id === null) throw new Error('Cannot map an empty disease page sentinel');
  return {
    id: row.id,
    cropId: row.cropId,
    cropName: row.cropName,
    cropScientificName: row.cropScientificName,
    modelLabel: row.modelLabel,
    diseaseName: row.diseaseName,
    description: row.description,
    symptoms: row.symptoms,
    management: row.management,
    prevention: row.prevention,
    sourceReference: row.sourceReference,
    contentStatus: row.contentStatus,
    reviewedAt: row.reviewedAt === null ? null : toIsoString(row.reviewedAt),
    active: row.active,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

const cropColumns = `
  c.id::text AS "id",
  c.name AS "name",
  c.scientific_name AS "scientificName",
  c.description AS "description",
  c.active AS "active",
  c.created_at AS "createdAt",
  c.updated_at AS "updatedAt"`;

const diseaseColumns = `
  d.id::text AS "id",
  d.crop_id::text AS "cropId",
  c.name AS "cropName",
  c.scientific_name AS "cropScientificName",
  d.model_label AS "modelLabel",
  d.disease_name AS "diseaseName",
  d.description AS "description",
  d.symptoms AS "symptoms",
  d.management AS "management",
  d.prevention AS "prevention",
  d.source_reference AS "sourceReference",
  d.content_status AS "contentStatus",
  d.reviewed_at AS "reviewedAt",
  d.active AS "active",
  d.created_at AS "createdAt",
  d.updated_at AS "updatedAt"`;

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  readonly #pool: Queryable;

  public constructor(pool: Pool | Queryable) {
    this.#pool = pool;
  }

  public async ping(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }

  public async listActiveModelLabels(): Promise<string[]> {
    const result = await this.#pool.query<{ modelLabel: string }>(
      `SELECT d.model_label AS "modelLabel"
       FROM diseases d
       INNER JOIN crops c ON c.id = d.crop_id
       WHERE d.active = TRUE AND c.active = TRUE
       ORDER BY d.model_label ASC`
    );
    return result.rows.map((row) => row.modelLabel);
  }

  public async listCrops(options: ListOptions): Promise<Page<Crop>> {
    const result = await this.#pool.query<CropRow>(
      `WITH filtered AS (
         SELECT ${cropColumns}
         FROM crops c
         WHERE c.active = TRUE
           AND ($1::text IS NULL
                OR strpos(lower(c.name), lower($1::text)) > 0
                OR strpos(lower(COALESCE(c.scientific_name, '')), lower($1::text)) > 0)
       ), page AS (
         SELECT * FROM filtered
         ORDER BY "name" ASC, "id" ASC
         LIMIT $2 OFFSET $3
       ), totals AS (
         SELECT COUNT(*)::text AS "totalCount" FROM filtered
       )
       SELECT page.*, totals."totalCount"
       FROM totals
       LEFT JOIN page ON TRUE
       ORDER BY page."name" ASC, page."id" ASC`,
      [options.search ?? null, options.limit, options.offset]
    );

    return {
      items: result.rows.filter((row) => row.id !== null).map(mapCrop),
      total: result.rows[0]?.totalCount === undefined ? 0 : Number(result.rows[0].totalCount)
    };
  }

  public async findCropById(id: string): Promise<Crop | null> {
    const result = await this.#pool.query<CropRow>(
      `SELECT ${cropColumns}
       FROM crops c
       WHERE c.id = $1::bigint AND c.active = TRUE
       LIMIT 1`,
      [id]
    );
    return result.rows[0] === undefined ? null : mapCrop(result.rows[0]);
  }

  public async listDiseases(options: DiseaseListOptions): Promise<Page<Disease>> {
    const result = await this.#pool.query<DiseaseRow>(
      `WITH filtered AS (
         SELECT ${diseaseColumns}
         FROM diseases d
         INNER JOIN crops c ON c.id = d.crop_id
         WHERE d.active = TRUE
           AND c.active = TRUE
           AND ($1::bigint IS NULL OR d.crop_id = $1::bigint)
           AND ($2::text IS NULL
                OR strpos(lower(d.disease_name), lower($2::text)) > 0
                OR strpos(lower(d.model_label), lower($2::text)) > 0)
       ), page AS (
         SELECT * FROM filtered
         ORDER BY "cropName" ASC, "diseaseName" ASC, "id" ASC
         LIMIT $3 OFFSET $4
       ), totals AS (
         SELECT COUNT(*)::text AS "totalCount" FROM filtered
       )
       SELECT page.*, totals."totalCount"
       FROM totals
       LEFT JOIN page ON TRUE
       ORDER BY page."cropName" ASC, page."diseaseName" ASC, page."id" ASC`,
      [options.cropId ?? null, options.search ?? null, options.limit, options.offset]
    );

    return {
      items: result.rows.filter((row) => row.id !== null).map(mapDisease),
      total: result.rows[0]?.totalCount === undefined ? 0 : Number(result.rows[0].totalCount)
    };
  }

  public async findDiseaseById(id: string): Promise<Disease | null> {
    const result = await this.#pool.query<DiseaseRow>(
      `SELECT ${diseaseColumns}
       FROM diseases d
       INNER JOIN crops c ON c.id = d.crop_id
       WHERE d.id = $1::bigint AND d.active = TRUE AND c.active = TRUE
       LIMIT 1`,
      [id]
    );
    return result.rows[0] === undefined ? null : mapDisease(result.rows[0]);
  }

  public async findDiseaseByModelLabel(modelLabel: string): Promise<Disease | null> {
    const result = await this.#pool.query<DiseaseRow>(
      `SELECT ${diseaseColumns}
       FROM diseases d
       INNER JOIN crops c ON c.id = d.crop_id
       WHERE d.model_label = $1 AND d.active = TRUE AND c.active = TRUE
       LIMIT 1`,
      [modelLabel]
    );
    return result.rows[0] === undefined ? null : mapDisease(result.rows[0]);
  }

  public async recordPrediction(record: PredictionRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO predictions
         (disease_id, model_label, confidence, uncertain, model_version)
       VALUES ($1::bigint, $2, $3, $4, $5)`,
      [
        record.diseaseId,
        record.modelLabel,
        record.confidence,
        record.uncertain,
        record.modelVersion
      ]
    );
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }
}
