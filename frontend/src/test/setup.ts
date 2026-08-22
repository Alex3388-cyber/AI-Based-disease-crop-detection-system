import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const defaultFetchResponse = {
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { crops: [] } }),
} as Response;

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:crop-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: vi.fn().mockResolvedValue(defaultFetchResponse),
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }),
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
