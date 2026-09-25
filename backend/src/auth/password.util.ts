import * as argon2 from 'argon2';

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 12 characters and include upper-case, lower-case, digit and symbol characters';

/** Password policy: >= 12 chars, upper, lower, digit, symbol. Returns list of violations. */
export function passwordPolicyViolations(password: string): string[] {
  const v: string[] = [];
  if (typeof password !== 'string' || password.length < 12) v.push('at least 12 characters');
  if (password.length > 256) v.push('at most 256 characters');
  if (!/[A-Z]/.test(password)) v.push('an upper-case letter');
  if (!/[a-z]/.test(password)) v.push('a lower-case letter');
  if (!/[0-9]/.test(password)) v.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) v.push('a symbol');
  return v;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Burn equivalent time for unknown users to reduce user enumeration via timing. */
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-Aa1!');
  await verifyPassword(await dummyHash, password);
}
