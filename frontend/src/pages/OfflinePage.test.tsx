import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('offline page', () => {
  it('clearly explains that server-side analysis is unavailable offline', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.history.pushState({}, '', '/offline');
    render(<App />);

    expect(screen.getByRole('heading', { name: /currently offline/i })).toBeInTheDocument();
    expect(screen.getByText(/cannot run AI disease detection without the server/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /start detection/i })).not.toBeInTheDocument();
  });
});
