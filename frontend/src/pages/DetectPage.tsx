import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { ImagePicker } from '../components/ImagePicker';
import { Notice } from '../components/Notice';
import { PageTitle } from '../components/PageTitle';
import { PredictionResult } from '../components/PredictionResult';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSupportedCrops } from '../hooks/useSupportedCrops';
import { uploadPrediction } from '../services/api';
import type { ErrorPresentation, Prediction, UploadProgress } from '../types/api';
import { ApiError, presentError } from '../utils/errors';
import { ImageValidationError, validateImage } from '../utils/imageValidation';

interface SelectedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

export function DetectPage() {
  const isOnline = useOnlineStatus();
  const { crops, hasError: cropsUnavailable, isLoading: cropsLoading } = useSupportedCrops();
  const [cropId, setCropId] = useState('');
  const [selected, setSelected] = useState<SelectedImage>();
  const [isValidating, setIsValidating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>({ percent: 0, stage: 'uploading' });
  const [error, setError] = useState<ErrorPresentation>();
  const [prediction, setPrediction] = useState<Prediction>();
  const abortRef = useRef<AbortController>();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (prediction) resultRef.current?.focus();
  }, [prediction]);
  useEffect(() => {
    return () => {
      if (selected?.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    };
  }, [selected?.previewUrl]);

  const handleSelect = async (file: File) => {
    setError(undefined);
    setPrediction(undefined);
    setIsValidating(true);
    try {
      const details = await validateImage(file);
      setSelected({ file, previewUrl: URL.createObjectURL(file), width: details.width, height: details.height });
    } catch (validationError) {
      setSelected(undefined);
      if (validationError instanceof ImageValidationError) {
        setError(presentError(new ApiError(validationError.code)));
      } else {
        setError(presentError(new ApiError('INVALID_IMAGE_CONTENT')));
      }
    } finally {
      setIsValidating(false);
    }
  };

  const removeImage = () => {
    setSelected(undefined);
    setError(undefined);
    setPrediction(undefined);
  };

  const analyze = async () => {
    if (!selected || isAnalyzing) return;
    if (!isOnline) {
      setError(presentError(new ApiError('OFFLINE')));
      return;
    }

    setError(undefined);
    setIsAnalyzing(true);
    setProgress({ percent: 5, stage: 'uploading' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await uploadPrediction(
        { image: selected.file, cropId: cropId || undefined },
        setProgress,
        controller.signal,
      );
      setPrediction(result);
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
        setError(presentError(requestError));
      }
    } finally {
      setIsAnalyzing(false);
      abortRef.current = undefined;
    }
  };

  const analyzeAnother = () => {
    setPrediction(undefined);
    setSelected(undefined);
    setError(undefined);
    setProgress({ percent: 0, stage: 'uploading' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (prediction && selected) {
    return (
      <section className="detect-page result-page">
        <PageTitle title="Detection result" />
        <div className="page-width narrow-width" ref={resultRef} tabIndex={-1}>
          <div className="page-intro page-intro--result">
            <p className="eyebrow">Analysis complete</p>
            <h1>Review your result carefully.</h1>
            <p>Confidence and uncertainty are shown alongside the supporting crop information.</p>
          </div>
          <PredictionResult prediction={prediction} previewUrl={selected.previewUrl} onAnalyzeAnother={analyzeAnother} />
        </div>
      </section>
    );
  }

  return (
    <section className="detect-page">
      <PageTitle title="Detect crop disease" />
      <div className="detect-hero">
        <div className="page-width narrow-width">
          <p className="eyebrow eyebrow--light"><span /> New analysis</p>
          <h1>Check a crop leaf.</h1>
          <p>Use a sharp, close photo. The result is preliminary decision support—not a guaranteed diagnosis.</p>
          <ol className="detect-steps" aria-label="Detection steps">
            <li className="detect-steps__active"><span>1</span> Add photo</li>
            <li><span>2</span> Analyze</li>
            <li><span>3</span> Review</li>
          </ol>
        </div>
      </div>

      <div className="page-width narrow-width detect-content">
        {!isOnline && (
          <Notice title="Internet connection required" message="The app shell works offline, but Version 1 analysis runs on the server. Reconnect before you submit." tone="warning" />
        )}
        {error && <Notice title={error.title} message={error.message} tone="danger" />}

        <div className="detect-layout">
          <div className="upload-card">
            <div className="card-heading">
              <span className="card-heading__number">01</span>
              <div><h2>Add a crop image</h2><p>Photograph one affected leaf against a simple background when possible.</p></div>
            </div>
            <ImagePicker
              disabled={isAnalyzing || isValidating}
              isValidating={isValidating}
              selected={selected}
              onSelect={(file) => void handleSelect(file)}
              onRemove={removeImage}
            />
            <div className="requirements-row" aria-label="Image requirements">
              <span><Icon name="check" size={15} /> JPEG, PNG, WEBP</span>
              <span><Icon name="check" size={15} /> Maximum 8 MB</span>
              <span><Icon name="check" size={15} /> Clear leaf in focus</span>
            </div>
          </div>

          <div className="options-card">
            <div className="card-heading card-heading--compact">
              <span className="card-heading__number">02</span>
              <div><h2>Confirm and analyze</h2><p>Crop selection is optional, but can provide useful context.</p></div>
            </div>
            <label className="field-label" htmlFor="crop-select">Crop type <span>Optional</span></label>
            <select
              id="crop-select"
              value={cropId}
              disabled={isAnalyzing || cropsLoading || cropsUnavailable}
              onChange={(event) => setCropId(event.target.value)}
            >
              <option value="">{cropsLoading ? 'Loading supported crops…' : 'Let the model identify the crop'}</option>
              {crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.name}</option>)}
            </select>
            {cropsUnavailable && <p className="field-help">Crop choices are unavailable. You can still analyze without selecting one.</p>}

            {isAnalyzing ? (
              <div className="analysis-progress" aria-live="polite">
                <div className="analysis-progress__top">
                  <span className="spinner" aria-hidden="true" />
                  <div>
                    <strong>{progress.stage === 'uploading' ? 'Uploading securely…' : 'Analyzing the image…'}</strong>
                    <p>{progress.stage === 'uploading' ? 'Sending the verified file' : 'Waiting for the detection model'}</p>
                  </div>
                  <span>{progress.percent}%</span>
                </div>
                <div className="analysis-progress__track" role="progressbar" aria-label="Analysis progress" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
                <button className="button button--quiet button--small" type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>
              </div>
            ) : (
              <button className="button button--primary button--large analyze-button" type="button" disabled={!selected || isValidating || !isOnline} onClick={() => void analyze()}>
                <Icon name="spark" size={20} /> Analyze crop image <Icon name="arrow" size={19} />
              </button>
            )}

            {error?.canRetry && selected && !isAnalyzing && (
              <button className="text-button" type="button" onClick={() => void analyze()}><Icon name="refresh" size={17} /> Retry analysis</button>
            )}
            <p className="privacy-note"><Icon name="shield" size={17} /> Your image is treated as untrusted input and is not retained by default.</p>
          </div>
        </div>

        <aside className="photo-tips">
          <div><Icon name="camera" size={23} /><h2>For a better photo</h2></div>
          <ul><li>Use natural, even light</li><li>Keep the affected area sharp</li><li>Fill the frame with one leaf</li><li>Avoid hands covering symptoms</li></ul>
        </aside>
      </div>
    </section>
  );
}
