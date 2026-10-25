import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../domain/contracts.ts';

export function integrationKey(value = process.env.WORKSPACE_INTEGRATION_KEY): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new DomainError('calendar_configuration_required');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new DomainError('calendar_configuration_required');
  return key;
}

// Purpose and owner are authenticated, not only encrypted. A database row copied
// to another workspace cannot be decrypted or used as a different kind of token.
export function seal(value: unknown, context: string, key = integrationKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`workspace:google-calendar:v1:${context}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function unseal<T>(value: string, context: string, key = integrationKey()): T {
  try {
    if (value.length > 40000) throw new Error('size');
    const [version, nonce, encrypted, tag, extra] = value.split('.');
    if (version !== 'v1' || extra || !nonce || !encrypted || !tag) throw new Error('format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
    decipher.setAAD(Buffer.from(`workspace:google-calendar:v1:${context}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')) as T;
  } catch { throw new DomainError('calendar_token_invalid'); }
}
