import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../config/app-config.service';

const VERSION = 'v1';
const BIN_MAGIC = Buffer.from('SEMB1', 'ascii');

/**
 * AES-256-GCM encryption for secrets at rest (MFA secrets, channel configs,
 * license keys) plus token helpers. Ciphertext format: `v1:<iv>:<tag>:<ciphertext>` (base64).
 */
export class CryptoCore {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key ?? '', 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be base64 of 32 bytes');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Invalid ciphertext format');
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Binary AES-256-GCM: `SEMB1` magic + iv(12) + tag(16) + ciphertext (used for screenshots at rest). */
  encryptBuffer(plain: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([BIN_MAGIC, iv, cipher.getAuthTag(), ct]);
  }

  decryptBuffer(payload: Buffer): Buffer {
    if (payload.length < BIN_MAGIC.length + 28 || !payload.subarray(0, BIN_MAGIC.length).equals(BIN_MAGIC)) {
      throw new Error('Invalid encrypted blob');
    }
    const o = BIN_MAGIC.length;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, payload.subarray(o, o + 12));
    decipher.setAuthTag(payload.subarray(o + 12, o + 28));
    return Buffer.concat([decipher.update(payload.subarray(o + 28)), decipher.final()]);
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value ?? null));
  }

  decryptJson<T = unknown>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Random opaque token `<prefix><base64url>` with `bytes` bytes of entropy. */
export function randomToken(prefix: string, bytes = 48): string {
  return prefix + crypto.randomBytes(bytes).toString('base64url');
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

@Injectable()
export class CryptoService extends CryptoCore {
  constructor(config: AppConfigService) {
    super(config.encryptionKey);
  }

  sha256(input: string | Buffer): string {
    return sha256Hex(input);
  }

  randomToken(prefix: string, bytes = 48): string {
    return randomToken(prefix, bytes);
  }

  safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    return safeEqual(a, b);
  }
}
