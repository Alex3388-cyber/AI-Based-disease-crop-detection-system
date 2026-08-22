import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageTitle } from '../components/PageTitle';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useSupportedCrops } from '../hooks/useSupportedCrops';

export function HomePage() {
  const { crops, hasError, isLoading, retry } = useSupportedCrops();
  const { canInstall, isInstalled, install } = usePwaInstall();

  return (
    <>
      <PageTitle title="AI crop disease detection" />
      <section className="hero">
        <div className="hero__texture" aria-hidden="true" />
        <div className="page-width hero__inner">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--light"><span /> AI-based crop disease detection</p>
            <h1>Detect crop disease from <em>leaf images.</em></h1>
            <p className="hero__lead">Upload a clear crop leaf image to receive a preliminary disease prediction, confidence score, symptoms and management information.</p>
            <div className="hero__actions">
              <Link className="button button--lime button--large" to="/detect">
                Detect crop disease <Icon name="arrow" />
              </Link>
              <Link className="button button--ghost-light button--large" to="/about">How it works</Link>
            </div>
            <div className="hero__trust">
              <span><Icon name="shield" size={17} /> Images are not retained by default</span>
              <span><Icon name="check" size={17} /> Clear uncertainty warnings</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual__orbit hero-visual__orbit--one" />
            <div className="hero-visual__orbit hero-visual__orbit--two" />
            <svg viewBox="0 0 420 460" className="hero-leaf">
              <path d="M79 361c155 31 274-58 302-285C210 62 91 168 79 361Z" fill="#ddea84" />
              <path d="M85 386c60-123 148-205 271-280M193 277l-13-91m13 91 98 6M130 334l-7-55m7 55 59 3" fill="none" stroke="#184838" strokeWidth="13" strokeLinecap="round" />
              <circle cx="278" cy="185" r="18" fill="#d8a94a" opacity=".85" />
              <circle cx="305" cy="153" r="9" fill="#d8a94a" opacity=".65" />
            </svg>
            <div className="scan-card scan-card--top"><span><Icon name="spark" size={17} /></span><div><strong>AI-assisted</strong><small>Preliminary analysis</small></div></div>
            <div className="scan-card scan-card--bottom"><span><Icon name="leaf" size={17} /></span><div><strong>Practical guidance</strong><small>Reviewed crop content</small></div></div>
            <div className="scan-line" />
          </div>
        </div>
      </section>

      <section className="quick-facts" aria-label="Image analysis requirements">
        <div className="page-width quick-facts__grid">
          <div><strong>3</strong><span>simple steps</span></div>
          <div><strong>8 MB</strong><span>maximum image</span></div>
          <div><strong>JPG · PNG · WEBP</strong><span>accepted formats</span></div>
          <div><strong>Online</strong><span>server-side AI in V1</span></div>
        </div>
      </section>

      <section className="section page-width process-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Built for the field</p>
            <h2>A clearer path from photo to next step.</h2>
          </div>
          <p>The system shows the model result, confidence level and a warning when the prediction is uncertain.</p>
        </div>
        <div className="process-grid">
          <article><span className="step-number">01</span><Icon name="camera" size={27} /><h3>Capture the leaf</h3><p>Use a close, well-lit image with the affected area in focus.</p></article>
          <article><span className="step-number">02</span><Icon name="microscope" size={27} /><h3>Run analysis</h3><p>The image is securely sent to the server-side detection model.</p></article>
          <article><span className="step-number">03</span><Icon name="shield" size={27} /><h3>Review carefully</h3><p>See confidence, symptoms, guidance, source information, and safety limits together.</p></article>
        </div>
      </section>

      <section className="crops-section">
        <div className="page-width">
          <div className="section-heading section-heading--compact">
            <div><p className="eyebrow">Available in the system</p><h2>Supported crops</h2></div>
            <Link className="text-link" to="/detect">Start a detection <Icon name="arrow" size={17} /></Link>
          </div>

          {isLoading && (
            <div className="crop-grid" aria-label="Loading supported crops">
              {[0, 1, 2, 3].map((item) => <div className="crop-card crop-card--skeleton" key={item} />)}
            </div>
          )}
          {!isLoading && hasError && (
            <div className="inline-state">
              <Icon name="wifi-off" size={24} />
              <div><strong>Supported crops could not be loaded.</strong><p>Check your connection and try again.</p></div>
              <button className="button button--secondary button--small" type="button" onClick={retry}>Try again</button>
            </div>
          )}
          {!isLoading && !hasError && crops.length === 0 && (
            <div className="inline-state"><Icon name="leaf" size={24} /><div><strong>No active crops are listed yet.</strong><p>An administrator can add supported crops to the knowledge base.</p></div></div>
          )}
          {!isLoading && !hasError && crops.length > 0 && (
            <div className="crop-grid">
              {crops.map((crop, index) => (
                <article className="crop-card" key={crop.id}>
                  <span className={`crop-card__symbol crop-card__symbol--${(index % 4) + 1}`}><Icon name="leaf" size={24} /></span>
                  <h3>{crop.name}</h3>
                  {crop.scientificName && <p className="crop-card__scientific">{crop.scientificName}</p>}
                  {crop.description && <p>{crop.description}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section page-width install-section">
        <div className="install-card">
          <div className="install-card__icon"><Icon name={isInstalled ? 'check' : 'download'} size={27} /></div>
          <div>
            <p className="eyebrow">Ready when you are</p>
            <h2>{isInstalled ? 'The app is installed.' : 'Install the application.'}</h2>
            <p>The interface can be installed on supported devices. An internet connection is required when analyzing images.</p>
          </div>
          {canInstall && !isInstalled ? (
            <button className="button button--lime button--large" type="button" onClick={() => void install()}><Icon name="download" /> Install app</button>
          ) : !isInstalled ? (
            <p className="install-card__hint">Use your browser’s <strong>Install app</strong> or <strong>Add to Home Screen</strong> option when available.</p>
          ) : (
            <span className="installed-badge"><Icon name="check" /> Installed</span>
          )}
        </div>
      </section>
    </>
  );
}
