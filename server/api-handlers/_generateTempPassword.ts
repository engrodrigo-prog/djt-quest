import { randomBytes } from 'crypto';
export function generateTempPassword(): string {
  // 12-char alphanumeric, mixed case
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(12))
    .map(b => chars[b % chars.length])
    .join('');
}
