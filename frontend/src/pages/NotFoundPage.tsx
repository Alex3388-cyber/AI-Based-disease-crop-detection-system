import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageTitle } from '../components/PageTitle';

export function NotFoundPage() {
  return (
    <section className="state-page">
      <PageTitle title="Page not found" />
      <div className="state-card">
        <span className="state-card__code">404</span>
        <p className="eyebrow">Page not found</p>
        <h1>This path has gone to seed.</h1>
        <p>The page may have moved, or the address may be incorrect.</p>
        <div className="state-card__actions">
          <Link className="button button--primary" to="/">Go home <Icon name="arrow" /></Link>
          <Link className="button button--secondary" to="/detect">Detect a disease</Link>
        </div>
      </div>
    </section>
  );
}
