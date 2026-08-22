import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageTitle } from '../components/PageTitle';

export function AboutPage() {
  return (
    <>
      <PageTitle title="About the system" />
      <section className="inner-hero">
        <div className="page-width narrow-width">
          <p className="eyebrow eyebrow--light"><span /> About the system</p>
          <h1>AI-based crop disease detection from leaf images.</h1>
          <p>This project uses image classification to provide a preliminary crop disease prediction from an uploaded leaf image.</p>
        </div>
      </section>

      <section className="section page-width narrow-width about-intro">
        <div className="about-intro__statement">
          <span><Icon name="leaf" size={28} /></span>
          <p>The system combines a React PWA, Node.js API, PostgreSQL database, Flask AI service, OpenCV preprocessing and a TensorFlow/Keras model.</p>
        </div>

        <div className="about-grid">
          <article>
            <span className="about-icon"><Icon name="microscope" size={25} /></span>
            <h2>What it does</h2>
            <p>It compares an uploaded crop image with classes learned by the deployed model, then links a returned model label to crop and disease information in the knowledge base.</p>
          </article>
          <article>
            <span className="about-icon"><Icon name="shield" size={25} /></span>
            <h2>What it does not do</h2>
            <p>It does not replace field inspection, laboratory testing, agronomists, extension officers, or locally approved treatment guidance.</p>
          </article>
          <article>
            <span className="about-icon"><Icon name="wifi" size={25} /></span>
            <h2>Version 1 scope</h2>
            <p>The application interface can be cached as a PWA, but prediction is performed on the server and requires an internet connection.</p>
          </article>
          <article>
            <span className="about-icon"><Icon name="info" size={25} /></span>
            <h2>Confidence matters</h2>
            <p>The interface reports model confidence and preserves the backend’s uncertainty decision. A low-confidence match is explicitly presented as uncertain.</p>
          </article>
        </div>
      </section>

      <section className="limits-section">
        <div className="page-width narrow-width limits-layout">
          <div>
            <p className="eyebrow">Known limitations</p>
            <h2>A photo is only one piece of evidence.</h2>
            <p>Results can be affected by lighting, focus, background clutter, crop growth stage, overlapping symptoms, pests, nutrient deficiencies, and diseases the model has not learned.</p>
          </div>
          <ul className="limits-list">
            <li><Icon name="check" size={18} /><span>Only active model classes and knowledge-base records can be returned.</span></li>
            <li><Icon name="check" size={18} /><span>If the trained model is unavailable, the system returns <code>MODEL_NOT_READY</code>.</span></li>
            <li><Icon name="check" size={18} /><span>Management content needs reliable source review before field use.</span></li>
            <li><Icon name="check" size={18} /><span>No farmer account, location, or device identity is required in Version 1.</span></li>
          </ul>
        </div>
      </section>

      <section className="section page-width narrow-width about-cta">
        <div><p className="eyebrow">Try the workflow</p><h2>Have a clear leaf photo?</h2><p>Submit it for preliminary analysis and review the confidence before acting.</p></div>
        <Link className="button button--primary button--large" to="/detect">Start detection <Icon name="arrow" /></Link>
      </section>
    </>
  );
}
