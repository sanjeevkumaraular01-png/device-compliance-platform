import { randomBytes } from 'crypto';
import { CryptoCore, randomToken, safeEqual, sha256Hex } from './crypto.service';

describe('CryptoCore (AES-256-GCM)', () => {
  const key = randomBytes(32).toString('base64');
  const c = new CryptoCore(key);

  it('round-trips strings', () => {
    const ct = c.encrypt('TOTP-SECRET-ABC');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct).not.toContain('TOTP-SECRET-ABC');
    expect(c.decrypt(ct)).toBe('TOTP-SECRET-ABC');
  });

  it('round-trips JSON including unicode', () => {
    const value = { webhookUrl: 'https://hooks.slack.com/x', to: ['+15551234567'], note: 'µ✓' };
    expect(c.decryptJson(c.encryptJson(value))).toEqual(value);
  });

  it('uses a random IV (same plaintext -> different ciphertexts)', () => {
    expect(c.encrypt('same')).not.toBe(c.encrypt('same'));
  });

  it('rejects tampered ciphertext (auth tag)', () => {
    const parts = c.encrypt('hello').split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => c.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects decryption with another key', () => {
    const other = new CryptoCore(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(c.encrypt('hello'))).toThrow();
  });

  it('rejects malformed payloads and bad keys', () => {
    expect(() => c.decrypt('garbage')).toThrow('Invalid ciphertext format');
    expect(() => new CryptoCore(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('token helpers', () => {
  it('randomToken has prefix and enough entropy', () => {
    const t = randomToken('sem_agt_', 48);
    expect(t.startsWith('sem_agt_')).toBe(true);
    expect(t.length).toBe('sem_agt_'.length + 64);
    expect(randomToken('x_')).not.toBe(randomToken('x_'));
  });

  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('safeEqual compares in constant time and handles bad input', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(null, 'abc')).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });
});
