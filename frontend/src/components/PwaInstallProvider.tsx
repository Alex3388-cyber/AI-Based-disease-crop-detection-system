import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { PwaInstallContext } from '../contexts/PwaInstallContext';
import type { BeforeInstallPromptEvent } from '../types/pwa';

function appIsInstalled(): boolean {
  const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standaloneDisplay || iosStandalone;
}

export function PwaInstallProvider({ children }: PropsWithChildren) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();
  const [isInstalled, setIsInstalled] = useState(appIsInstalled);

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(undefined);
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(undefined);
      return true;
    }
    return false;
  }, [installPrompt]);

  const value = useMemo(
    () => ({ canInstall: Boolean(installPrompt), isInstalled, install }),
    [install, installPrompt, isInstalled],
  );

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}
