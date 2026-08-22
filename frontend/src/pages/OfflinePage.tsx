import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageTitle } from '../components/PageTitle';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflinePage() {
  const isOnline = useOnlineStatus();
  return (
    <section className="state-page">
      <PageTitle title="Offline" />
      <div className="state-card">
        <span className={`state-card__icon ${isOnline ? 'state-card__icon--online' : ''}`}>
          <Icon name={isOnline ? 'wifi' : 'wifi-off'} size={35} />
        </span>
        <p className="eyebrow">Connection status</p>
        <h1>{isOnline ? 'You’re back online.' : 'You’re currently offline.'}</h1>
        <p>{isOnline ? 'The server-side disease detection workflow is available again.' : 'This cached application shell remains available, but Version 1 cannot run AI disease detection without the server.'}</p>
        <div className="state-card__details">
          <div><Icon name="check" size={18} /><span>Browse cached application pages</span></div>
          <div className={!isOnline ? 'state-card__unavailable' : ''}><Icon name={isOnline ? 'check' : 'close'} size={18} /><span>Upload and analyze a new crop image</span></div>
        </div>
        <div className="state-card__actions">
          {isOnline && <Link className="button button--primary" to="/detect">Start detection <Icon name="arrow" /></Link>}
          <Link className="button button--secondary" to="/">Return home</Link>
        </div>
      </div>
    </section>
  );
}
