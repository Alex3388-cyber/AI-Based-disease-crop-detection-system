import { describe, expect, it, vi } from 'vitest';
import { jpegHeader, makeFile, pngHeader } from '../test/files';
import { MAX_IMAGE_BYTES, validateImage } from './imageValidation';

describe('validateImage', () => {
  it('accepts a decodable image whose MIME type and signature agree', async () => {
    const file = makeFile();
    await expect(validateImage(file)).resolves.toEqual({ type: 'image/jpeg', width: 800, height: 600 });
    expect(createImageBitmap).toHaveBeenCalledWith(file);
  });

  it('rejects unsupported declared file types before decoding', async () => {
    const file = makeFile('leaf.gif', 'image/gif', [0x47, 0x49, 0x46, 0x38]);
    await expect(validateImage(file)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it.each(['image/jpg', ''])('rejects non-canonical MIME %j before upload', async (type) => {
    const file = makeFile('leaf.jpg', type);

    await expect(validateImage(file)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('rejects an oversized image', async () => {
    const file = makeFile('huge.jpg', 'image/jpeg', jpegHeader, MAX_IMAGE_BYTES + 1);
    await expect(validateImage(file)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects a spoofed MIME type when the binary signature does not match', async () => {
    const file = makeFile('spoofed.jpg', 'image/jpeg', pngHeader);
    await expect(validateImage(file)).rejects.toMatchObject({ code: 'INVALID_IMAGE_CONTENT' });
  });

  it('rejects an image that cannot be decoded', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'));
    const file = makeFile();
    await expect(validateImage(file)).rejects.toMatchObject({ code: 'INVALID_IMAGE_CONTENT' });
  });

  it('rejects excessive decoded dimensions', async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 13_000, height: 100, close: vi.fn() } as unknown as ImageBitmap);
    const file = makeFile();
    await expect(validateImage(file)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects images below the shared minimum dimensions', async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({
      width: 16,
      height: 16,
      close: vi.fn(),
    } as unknown as ImageBitmap);

    await expect(validateImage(makeFile())).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});
