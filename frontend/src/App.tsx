import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PwaInstallProvider } from './components/PwaInstallProvider';
import { RouteEffects } from './components/RouteEffects';
import { AppShell } from './layouts/AppShell';
import { AboutPage } from './pages/AboutPage';
import { DetectPage } from './pages/DetectPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OfflinePage } from './pages/OfflinePage';

export function App() {
  return (
    <PwaInstallProvider>
      <BrowserRouter>
        <RouteEffects />
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="detect" element={<DetectPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="offline" element={<OfflinePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PwaInstallProvider>
  );
}
