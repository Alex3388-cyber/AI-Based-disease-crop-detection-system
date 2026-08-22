import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { uploadPrediction } from '../services/api';
import { makeFile } from '../test/files';
import type { Crop, Prediction } from '../types/api';
import { ApiError } from '../utils/errors';

interface ApiModule {
  getSupportedCrops: (signal?: AbortSignal) => Promise<Crop[]>;
  uploadPrediction: typeof uploadPrediction;
}

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<ApiModule>();
  return { ...original, uploadPrediction: vi.fn() };
});

const certainPrediction: Prediction = {
  crop: 'Tomato',
  disease: 'Early blight',
  confidence: 0.916,
  uncertain: false,
  description: 'A reviewed disease description.',
  symptoms: ['Dark concentric leaf spots'],
  management: ['Use validated local management guidance'],
  prevention: ['Rotate crops where appropriate'],
  sourceReference: 'https://example.edu/plant-health',
  modelVersion: '1.0.0',
};

async function renderDetectionAndSelect(file = makeFile()) {
  window.history.pushState({}, '', '/detect');
  const user = userEvent.setup({ applyAccept: false });
  render(<App />);
  const input = screen.getByLabelText(/drop a crop image here/i);
  await user.upload(input, file);
  return user;
}

describe('disease detection workflow', () => {
  beforeEach(() => {
    vi.mocked(uploadPrediction).mockReset();
  });

  it('selects, validates, and previews a valid image', async () => {
    await renderDetectionAndSelect();
    expect(await screen.findByAltText('Selected crop leaf preview')).toHaveAttribute('src', 'blob:crop-preview');
    expect(screen.getByText(/800 × 600px/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze crop image/i })).toBeEnabled();
  });

  it('shows a clear client validation error for an unsupported file', async () => {
    const file = makeFile('notes.txt', 'text/plain', [0x6e, 0x6f, 0x74, 0x20, 0x61, 0x6e, 0x20, 0x69, 0x6d, 0x61, 0x67, 0x65]);
    await renderDetectionAndSelect(file);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported image format');
    expect(screen.queryByAltText('Selected crop leaf preview')).not.toBeInTheDocument();
  });

  it('shows upload progress, then renders the API prediction', async () => {
    let finishUpload: ((value: Prediction) => void) | undefined;
    vi.mocked(uploadPrediction).mockImplementation((_request, onProgress) => {
      onProgress({ percent: 47, stage: 'uploading' });
      return new Promise((resolve) => { finishUpload = resolve; });
    });
    const user = await renderDetectionAndSelect();

    await user.click(screen.getByRole('button', { name: /analyze crop image/i }));
    expect(screen.getByText('Uploading securely…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Analysis progress' })).toHaveAttribute('aria-valuenow', '47');

    await act(async () => finishUpload?.(certainPrediction));
    expect(await screen.findByRole('heading', { level: 2, name: 'Early blight' })).toBeInTheDocument();
    expect(screen.getByText('91.6%')).toBeInTheDocument();
    expect(screen.getByText('Dark concentric leaf spots')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.edu/plant-health' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('maps MODEL_NOT_READY without displaying a fake result', async () => {
    vi.mocked(uploadPrediction).mockRejectedValueOnce(new ApiError('MODEL_NOT_READY', 503));
    const user = await renderDetectionAndSelect();
    await user.click(screen.getByRole('button', { name: /analyze crop image/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Detection model is not ready');
    expect(screen.getByRole('alert')).toHaveTextContent('no prediction was made');
    expect(screen.queryByText('Likely match')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry analysis/i })).toBeInTheDocument();
  });

  it('prominently marks a low-confidence result as uncertain', async () => {
    vi.mocked(uploadPrediction).mockResolvedValueOnce({
      ...certainPrediction,
      confidence: 0.421,
      uncertain: true,
    });
    const user = await renderDetectionAndSelect();
    await user.click(screen.getByRole('button', { name: /analyze crop image/i }));

    expect(await screen.findByText('Uncertain result')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not treat this as a confirmed diagnosis/i);
    expect(screen.getByText('42.1%')).toBeInTheDocument();
  });

  it('disables analysis and explains the Version 1 offline limit', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.history.pushState({}, '', '/detect');
    render(<App />);

    expect(screen.getByText('Internet connection required')).toBeInTheDocument();
    expect(screen.getAllByText(/AI detection needs the internet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /analyze crop image/i })).toBeDisabled();
    expect(uploadPrediction).not.toHaveBeenCalled();
  });

  it('removes a selected image and returns to the picker', async () => {
    const user = await renderDetectionAndSelect();
    await screen.findByAltText('Selected crop leaf preview');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByAltText('Selected crop leaf preview')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/drop a crop image here/i)).toBeInTheDocument();
  });
});
