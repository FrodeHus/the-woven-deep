import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
