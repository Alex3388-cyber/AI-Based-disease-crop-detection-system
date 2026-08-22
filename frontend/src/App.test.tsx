import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('application routes', () => {
  it('renders the home page and loads supported crops from the API', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          crops: [
            { id: 7, name: 'Maize', scientific_name: 'Zea mays', description: 'Active crop record' },
            { id: 9, name: 'Tomato', scientificName: 'Solanum lycopersicum' },
          ],
        },
      }),
    } as Response);

    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: /spot crop disease signs earlier/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: 'Maize' })).toBeInTheDocument();
    expect(screen.getByText('Zea mays')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /detect crop disease/i })).toHaveAttribute('href', '/detect');
  });

  it('renders the About route', () => {
    window.history.pushState({}, '', '/about');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /useful plant-health context/i })).toBeInTheDocument();
    expect(screen.getByText(/MODEL_NOT_READY/)).toBeInTheDocument();
  });

  it('provides a safe not-found route', () => {
    window.history.pushState({}, '', '/does-not-exist');
    render(<App />);
    expect(screen.getByRole('heading', { name: /this path has gone to seed/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });
});
