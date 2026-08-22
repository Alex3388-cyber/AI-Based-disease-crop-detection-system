import { describe, expect, it, vi } from 'vitest';
import { PostgresKnowledgeRepository } from '../src/repositories/postgres-knowledge-repository.js';

function queryResult(rows: unknown[]) {
  return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] };
}

describe('PostgresKnowledgeRepository', () => {
  it('preserves the matching total when a requested page has no rows', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([
      { id: null, totalCount: '7' }
    ]));
    const repository = new PostgresKnowledgeRepository({
      query,
      end: vi.fn(async () => undefined)
    } as never);

    await expect(repository.listCrops({ limit: 20, offset: 100 })).resolves.toEqual({
      items: [],
      total: 7
    });
  });

  it('lists only active model labels in deterministic order for readiness', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([
      { modelLabel: 'maize_healthy' },
      { modelLabel: 'maize_leaf_blight' }
    ]));
    const repository = new PostgresKnowledgeRepository({
      query,
      end: vi.fn(async () => undefined)
    } as never);

    await expect(repository.listActiveModelLabels()).resolves.toEqual([
      'maize_healthy',
      'maize_leaf_blight'
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('d.active = TRUE AND c.active = TRUE');
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY d.model_label ASC');
  });

  it('keeps hostile search input in query parameters', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([]));
    const repository = new PostgresKnowledgeRepository({
      query,
      end: vi.fn(async () => undefined)
    } as never);
    const hostile = "%' OR 1=1; DROP TABLE crops; --";
    await repository.listCrops({ search: hostile, limit: 20, offset: 0 });

    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('$1::text');
    expect(sql).not.toContain(hostile);
    expect(values).toEqual([hostile, 20, 0]);
  });

  it('parameterizes exact model-label lookup', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([]));
    const repository = new PostgresKnowledgeRepository({
      query,
      end: vi.fn(async () => undefined)
    } as never);
    const label = "maize_blight' OR '1'='1";
    await repository.findDiseaseByModelLabel(label);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('d.model_label = $1');
    expect(sql).not.toContain(label);
    expect(values).toEqual([label]);
  });

  it('stores only anonymous prediction metadata', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([]));
    const repository = new PostgresKnowledgeRepository({
      query,
      end: vi.fn(async () => undefined)
    } as never);
    await repository.recordPrediction({
      diseaseId: '7',
      modelLabel: 'maize_leaf_blight',
      confidence: 0.75,
      uncertain: false,
      modelVersion: '1.2.0'
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('(disease_id, model_label, confidence, uncertain, model_version)');
    expect(sql).not.toMatch(/filename|image|location|user/i);
    expect(values).toEqual(['7', 'maize_leaf_blight', 0.75, false, '1.2.0']);
  });
});
