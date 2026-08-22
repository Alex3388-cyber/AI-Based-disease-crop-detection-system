import { useContext } from 'react';
import { PwaInstallContext } from '../contexts/PwaInstallContext';
import type { PwaInstallState } from '../types/pwa';

export function usePwaInstall(): PwaInstallState {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error('usePwaInstall must be used within PwaInstallProvider.');
  return context;
}
