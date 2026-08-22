import { createHash } from 'node:crypto';

export function classSetDigest(labels: readonly string[]): string {
  return createHash('sha256')
    .update([...labels].sort().join('\n'), 'utf8')
    .digest('hex');
}
