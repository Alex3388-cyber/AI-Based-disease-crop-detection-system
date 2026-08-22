export const jpegHeader = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
export const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

export function makeFile(
  name = 'leaf.jpg',
  type = 'image/jpeg',
  bytes: number[] = jpegHeader,
  reportedSize?: number,
): File {
  const file = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(file, 'slice', {
    configurable: true,
    value: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }),
  });
  if (reportedSize !== undefined) {
    Object.defineProperty(file, 'size', { configurable: true, value: reportedSize });
  }
  return file;
}
