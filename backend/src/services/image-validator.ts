import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../errors/app-error.js';

type AllowedFormat = 'jpeg' | 'png' | 'webp';

export interface ImageValidationOptions {
  minDimension: number;
  maxDimension: number;
  maxPixels: number;
}

export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface ValidatedImage {
  buffer: Buffer;
  format: AllowedFormat;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

const formatDetails: Record<AllowedFormat, {
  mimeType: ValidatedImage['mimeType'];
  extensions: readonly string[];
  canonicalExtension: ValidatedImage['extension'];
}> = {
  jpeg: { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], canonicalExtension: 'jpg' },
  png: { mimeType: 'image/png', extensions: ['.png'], canonicalExtension: 'png' },
  webp: { mimeType: 'image/webp', extensions: ['.webp'], canonicalExtension: 'webp' }
};

function formatFromMagic(buffer: Buffer): AllowedFormat | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

function validateClientMetadata(file: UploadedImageFile, format: AllowedFormat): void {
  const hasControlCharacter = [...file.originalname].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (
    file.originalname.includes('/') ||
    file.originalname.includes('\\') ||
    hasControlCharacter
  ) {
    throw new AppError('INVALID_IMAGE', 'The image filename is invalid.', 400);
  }

  const details = formatDetails[format];
  const extension = path.extname(file.originalname).toLowerCase();
  if (!details.extensions.includes(extension) || file.mimetype.toLowerCase() !== details.mimeType) {
    throw new AppError(
      'UNSUPPORTED_FILE_TYPE',
      'Only matching JPEG, PNG, and WEBP image files are accepted.',
      415
    );
  }
}

export async function validateImage(
  file: UploadedImageFile,
  options: ImageValidationOptions
): Promise<ValidatedImage> {
  if (file.buffer.length === 0) {
    throw new AppError('INVALID_IMAGE', 'The uploaded image is empty.', 400);
  }

  const magicFormat = formatFromMagic(file.buffer);
  if (magicFormat === null) {
    throw new AppError(
      'INVALID_IMAGE_CONTENT',
      'The uploaded file does not contain a supported image.',
      422
    );
  }
  validateClientMetadata(file, magicFormat);

  try {
    const imageOptions = {
      failOn: 'error' as const,
      limitInputPixels: options.maxPixels,
      sequentialRead: true,
      animated: false
    };
    const pipeline = sharp(file.buffer, imageOptions);
    const metadata = await pipeline.metadata();

    if (metadata.format !== magicFormat) {
      throw new AppError(
        'INVALID_IMAGE_CONTENT',
        'The image content does not match its file format.',
        422
      );
    }

    const width = metadata.width;
    const height = metadata.height;
    if (width === undefined || height === undefined) {
      throw new AppError('INVALID_IMAGE_CONTENT', 'The image dimensions could not be read.', 422);
    }
    if (
      width < options.minDimension ||
      height < options.minDimension ||
      width > options.maxDimension ||
      height > options.maxDimension ||
      width * height > options.maxPixels
    ) {
      throw new AppError(
        'INVALID_IMAGE_CONTENT',
        'The image dimensions are outside the permitted range.',
        422
      );
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new AppError('INVALID_IMAGE_CONTENT', 'Animated or multi-page images are not accepted.', 422);
    }

    // stats() forces a full pixel decode; metadata and magic bytes alone would
    // accept some truncated or otherwise malformed image payloads.
    await sharp(file.buffer, imageOptions).stats();

    const details = formatDetails[magicFormat];
    return {
      buffer: file.buffer,
      format: magicFormat,
      mimeType: details.mimeType,
      extension: details.canonicalExtension,
      width,
      height
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'INVALID_IMAGE_CONTENT',
      'The uploaded image is malformed or unsafe to process.',
      422,
      { cause: error }
    );
  }
}
