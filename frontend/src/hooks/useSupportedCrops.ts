import { useCallback, useEffect, useState } from 'react';
import { getSupportedCrops } from '../services/api';
import type { Crop } from '../types/api';

interface SupportedCropsState {
  crops: Crop[];
  isLoading: boolean;
  hasError: boolean;
  retry: () => void;
}

export function useSupportedCrops(): SupportedCropsState {
  const [crops, setCrops] = useState<Crop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [requestKey, setRequestKey] = useState(0);

  const retry = useCallback(() => setRequestKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);

    void getSupportedCrops(controller.signal)
      .then((items) => setCrops(items))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setCrops([]);
          setHasError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [requestKey]);

  return { crops, isLoading, hasError, retry };
}
