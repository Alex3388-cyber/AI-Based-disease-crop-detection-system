export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_EDGE = 8_192;
export const MIN_IMAGE_EDGE = 32;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];
export type ImageValidationCode =
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'INVALID_IMAGE_CONTENT'
  | 'UNSUPPORTED_FILE_TYPE';

export interface ValidatedImage {
  type: AcceptedImageType;
  width: number;
  height: number;
}

export class ImageValidationError extends Error {
  readonly code: ImageValidationCode;

  constructor(code: ImageValidationCode) {
    super(code);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

function detectSignature(bytes: Uint8Array): AcceptedImageType | undefined {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) return 'image/jpeg';

  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (isPng) return 'image/png';

  const ascii = (index: number) => String.fromCharCode(bytes[index] ?? 0);
  const isWebp =
    `${ascii(0)}${ascii(1)}${ascii(2)}${ascii(3)}` === 'RIFF' &&
    `${ascii(8)}${ascii(9)}${ascii(10)}${ascii(11)}` === 'WEBP';
  if (isWebp) return 'image/webp';

  return undefined;
}

async function readHeader(file: File): Promise<Uint8Array> {
  const buffer = await file.slice(0, 16).arrayBuffer();
  return new Uint8Array(buffer);
}

async function decodeDimensions(file: File): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in globalThis) {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      throw new ImageValidationError('INVALID_IMAGE_CONTENT');
    }
  }

  return await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new ImageValidationError('INVALID_IMAGE_CONTENT'));
    };
    image.src = objectUrl;
  });
}

export async function validateImage(file: File): Promise<ValidatedImage> {
  if (file.size === 0) throw new ImageValidationError('INVALID_IMAGE');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageValidationError('FILE_TOO_LARGE');

  const declaredType = file.type;
  if (!ACCEPTED_IMAGE_TYPES.includes(declaredType as AcceptedImageType)) {
    throw new ImageValidationError('UNSUPPORTED_FILE_TYPE');
  }

  let detectedType: AcceptedImageType | undefined;
  try {
    detectedType = detectSignature(await readHeader(file));
  } catch {
    throw new ImageValidationError('INVALID_IMAGE_CONTENT');
  }

  if (!detectedType) throw new ImageValidationError('INVALID_IMAGE_CONTENT');
  if (declaredType !== detectedType) {
    throw new ImageValidationError('INVALID_IMAGE_CONTENT');
  }

  const { width, height } = await decodeDimensions(file);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_IMAGE_EDGE ||
    height < MIN_IMAGE_EDGE ||
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new ImageValidationError('INVALID_IMAGE');
  }

  return { type: detectedType, width, height };
}
