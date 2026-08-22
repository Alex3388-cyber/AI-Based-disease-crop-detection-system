import { createContext } from 'react';
import type { PwaInstallState } from '../types/pwa';

export const PwaInstallContext = createContext<PwaInstallState | undefined>(undefined);
