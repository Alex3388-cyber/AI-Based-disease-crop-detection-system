import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors/app-error.js';
import {
  validateImage,
  type UploadedImageFile
} from '../src/services/image-validator.js';

const options = { minDimension: 16, maxDimension: 8_000, maxPixels: 25_000_000 };
let png: Buffer;
let jpeg: Buffer;
let webp: Buffer;

beforeAll(async () => {
  const source = sharp({
    create: { width: 48, height: 32, channels: 3, background: '#3c8c42' }
  });
  png = await source.clone().png().toBuffer();
  jpeg = await source.clone().jpeg().toBuffer();
  webp = await source.clone().webp().toBuffer();
});

function uploadedFile(
  buffer: Buffer,
  originalname: string,
  mimetype: string
): UploadedImageFile {
  return {
    originalname,
    mimetype,
    buffer
  };
}

describe('validateImage', () => {
  it.each([
    ['png', () => png, 'leaf.png', 'image/png'],
    ['jpeg', () => jpeg, 'leaf.jpeg', 'image/jpeg'],
    ['webp', () => webp, 'leaf.webp', 'image/webp']
  ] as const)('accepts a fully decodable %s with matching metadata', async (
    expectedFormat,
    buffer,
    filename,
    mimeType
  ) => {
    const result = await validateImage(uploadedFile(buffer(), filename, mimeType), options);
    expect(result).toMatchObject({ format: expectedFormat, width: 48, height: 32 });
  });

  it('rejects traversal-like filenames even though images are never stored', async () => {
    await expect(validateImage(
      uploadedFile(png, '..\\..\\payload.png', 'image/png'),
      options
    )).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects extension/content and MIME/content mismatches', async () => {
    await expect(validateImage(uploadedFile(png, 'leaf.jpg', 'image/jpeg'), options))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    await expect(validateImage(uploadedFile(png, 'leaf.png', 'application/octet-stream'), options))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('rejects valid but resource-policy-violating image dimensions', async () => {
    await expect(validateImage(uploadedFile(png, 'leaf.png', 'image/png'), {
      ...options,
      minDimension: 64
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE_CONTENT' });
  });

  it('returns only sanitized public image errors', async () => {
    try {
      await validateImage(
        uploadedFile(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'leaf.jpg', 'image/jpeg'),
        options
      );
      throw new Error('Expected validation to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain('sharp');
      expect((error as AppError).code).toBe('INVALID_IMAGE_CONTENT');
    }
  });
});
