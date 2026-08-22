import { describe, expect, it } from 'vitest';
import { ApiError, presentError, toApiErrorCode } from './errors';

describe('API error presentation', () => {
  it('preserves SERVICE_BUSY and presents actionable retry guidance', () => {
    expect(toApiErrorCode('SERVICE_BUSY', 503)).toBe('SERVICE_BUSY');
    expect(presentError(new ApiError('SERVICE_BUSY', 503))).toEqual({
      title: 'Detection service is busy',
      message: 'The service is handling other analyses. Wait a moment, then try again.',
      canRetry: true,
    });
  });

  it('keeps selected-crop request errors actionable', () => {
    expect(toApiErrorCode('INVALID_REQUEST', 400)).toBe('INVALID_REQUEST');
    expect(presentError(new ApiError('INVALID_REQUEST', 400)).message).toContain(
      'reselect the crop'
    );
  });
});
