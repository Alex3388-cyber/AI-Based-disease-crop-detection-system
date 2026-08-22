import type { Prediction } from '../types/api';
import { Icon } from './Icon';

interface PredictionResultProps {
  prediction: Prediction;
  previewUrl: string;
  onAnalyzeAnother: () => void;
}

interface GuidanceSectionProps {
  icon: 'leaf' | 'shield' | 'spark';
  title: string;
  items: string[];
  emptyMessage: string;
}

function GuidanceSection({ icon, title, items, emptyMessage }: GuidanceSectionProps) {
  return (
    <section className="guidance-card">
      <div className="guidance-card__heading">
        <span><Icon name={icon} size={21} /></span>
        <h3>{title}</h3>
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      ) : (
        <p className="muted-copy">{emptyMessage}</p>
      )}
    </section>
  );
}

function safeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function PredictionResult({ prediction, previewUrl, onAnalyzeAnother }: PredictionResultProps) {
  const percentage = Math.round(prediction.confidence * 1000) / 10;
  const sourceUrl = safeHttpUrl(prediction.sourceReference);

  return (
    <article className={`result-panel${prediction.uncertain ? ' result-panel--uncertain' : ''}`} aria-labelledby="result-heading">
      <div className="result-panel__top">
        <div className="result-image-wrap">
          <img src={previewUrl} alt="Crop image submitted for analysis" />
          <span><Icon name="spark" size={15} /> AI analyzed</span>
        </div>
        <div className="result-summary">
          <span className={`result-status${prediction.uncertain ? ' result-status--uncertain' : ''}`}>
            <Icon name={prediction.uncertain ? 'warning' : 'check'} size={16} />
            {prediction.uncertain ? 'Uncertain result' : 'Likely match'}
          </span>
          <p className="eyebrow">Analysis result</p>
          <h2 id="result-heading">{prediction.disease}</h2>
          <p className="result-crop"><Icon name="leaf" size={18} /> {prediction.crop}</p>
          {prediction.description && <p className="result-description">{prediction.description}</p>}

          <div className="confidence-block">
            <div className="confidence-block__label">
              <span>Model confidence</span>
              <strong>{percentage}%</strong>
            </div>
            <div
              className="confidence-meter"
              role="progressbar"
              aria-label="Model confidence"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <span style={{ width: `${percentage}%` }} />
            </div>
          </div>
        </div>
      </div>

      {prediction.uncertain && (
        <div className="uncertain-callout" role="alert">
          <Icon name="warning" size={23} />
          <div>
            <strong>Uncertain result — do not treat this as a confirmed diagnosis.</strong>
            <p>{prediction.warning ?? 'Try a sharp, close photo of one leaf in natural light, or ask a qualified agricultural professional.'}</p>
          </div>
        </div>
      )}

      <div className="guidance-grid">
        <GuidanceSection
          icon="spark"
          title="Common symptoms"
          items={prediction.symptoms}
          emptyMessage="No reviewed symptom information is available for this result."
        />
        <GuidanceSection
          icon="leaf"
          title="Management"
          items={prediction.management}
          emptyMessage="Recommendation pending expert/source validation."
        />
        <GuidanceSection
          icon="shield"
          title="Prevention"
          items={prediction.prevention}
          emptyMessage="Prevention guidance pending expert/source validation."
        />
      </div>

      <div className="source-card">
        <div>
          <span className="source-card__label">Information source</span>
          {prediction.sourceReference ? (
            sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{prediction.sourceReference}</a>
            ) : (
              <p>{prediction.sourceReference}</p>
            )
          ) : (
            <p>Source reference pending validation.</p>
          )}
          {prediction.modelVersion && <small>Model version {prediction.modelVersion}</small>}
        </div>
        <Icon name="info" size={22} />
      </div>

      <div className="result-disclaimer">
        <Icon name="shield" size={23} />
        <p><strong>Preliminary decision support only.</strong> AI can make mistakes. Confirm the result before making crop-treatment decisions, and follow locally approved agricultural guidance.</p>
      </div>

      <button className="button button--primary result-another" type="button" onClick={onAnalyzeAnother}>
        <Icon name="refresh" size={19} /> Analyze another image
      </button>
    </article>
  );
}
