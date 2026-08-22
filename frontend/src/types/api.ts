export interface Crop {
  id: string;
  name: string;
  scientificName?: string;
  description?: string;
}

export interface Prediction {
  crop: string;
  disease: string;
  modelLabel?: string;
  confidence: number;
  uncertain: boolean;
  warning?: string;
  description?: string;
  symptoms: string[];
  management: string[];
  prevention: string[];
  sourceReference?: string;
  modelVersion?: string;
}

export interface PredictionRequest {
  image: File;
  cropId?: string;
}

export type UploadStage = 'uploading' | 'analyzing';

export interface UploadProgress {
  percent: number;
  stage: UploadStage;
}

export interface ErrorPresentation {
  title: string;
  message: string;
  canRetry: boolean;
}
