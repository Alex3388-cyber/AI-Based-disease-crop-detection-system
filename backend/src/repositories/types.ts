export interface Crop {
  id: string;
  name: string;
  scientificName: string | null;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ContentStatus = 'pending' | 'validated' | 'retired';

export interface Disease {
  id: string;
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
  contentStatus: ContentStatus;
  reviewedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ListOptions {
  search?: string | undefined;
  limit: number;
  offset: number;
}

export interface DiseaseListOptions extends ListOptions {
  cropId?: string | undefined;
}

export interface PredictionRecord {
  diseaseId: string;
  modelLabel: string;
  confidence: number;
  uncertain: boolean;
  modelVersion: string;
}

export interface KnowledgeRepository {
  ping(): Promise<void>;
  listActiveModelLabels(): Promise<string[]>;
  listCrops(options: ListOptions): Promise<Page<Crop>>;
  findCropById(id: string): Promise<Crop | null>;
  listDiseases(options: DiseaseListOptions): Promise<Page<Disease>>;
  findDiseaseById(id: string): Promise<Disease | null>;
  findDiseaseByModelLabel(modelLabel: string): Promise<Disease | null>;
  recordPrediction(record: PredictionRecord): Promise<void>;
  close(): Promise<void>;
}
