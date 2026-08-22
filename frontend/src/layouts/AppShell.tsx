import { NavLink, Outlet } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePwaInstall } from '../hooks/usePwaInstall';

const navItems = [
  { to: '/', label: 'Home', icon: 'home' as const, end: true },
  { to: '/detect', label: 'Detect', icon: 'microscope' as const, end: false },
  { to: '/about', label: 'About', icon: 'info' as const, end: false },
];

export function AppShell() {
  const isOnline = useOnlineStatus();
  const { canInstall, isInstalled, install } = usePwaInstall();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="site-header__inner page-width">
          <Brand />
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navItems.map((item) => (
              <NavLink key={item.to} end={item.end} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <span className={`network-pill ${isOnline ? 'network-pill--online' : 'network-pill--offline'}`} role="status">
              <Icon name={isOnline ? 'wifi' : 'wifi-off'} size={16} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {canInstall && !isInstalled && (
              <button className="button button--small button--ink" type="button" onClick={() => void install()}>
                <Icon name="download" size={17} />
                Install app
              </button>
            )}
            {isInstalled && <span className="installed-label"><Icon name="check" size={16} /> Installed</span>}
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="offline-banner" role="status">
          <div className="page-width">
            <Icon name="wifi-off" />
            <span>You’re offline. You can browse this app, but AI detection needs the internet.</span>
            <NavLink to="/offline">Learn more</NavLink>
          </div>
        </div>
      )}

      <main id="main-content">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="page-width site-footer__inner">
          <Brand />
          <p>Preliminary AI-assisted crop guidance. Always confirm important decisions with a qualified agricultural professional.</p>
          <span>Version 1.0</span>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <NavLink key={item.to} end={item.end} to={item.to}>
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
