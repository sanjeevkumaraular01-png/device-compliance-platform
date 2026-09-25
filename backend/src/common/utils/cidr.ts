import { isIP } from 'net';

/** Parse an IPv4/IPv6 address into [version, bigint]. IPv4-mapped IPv6 is unwrapped to IPv4. */
export function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  let addr = ip.trim();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.substring(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) addr = mapped[1];
  const kind = isIP(addr);
  if (kind === 4) {
    const parts = addr.split('.').map(Number);
    return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (kind === 6) {
    let head = addr;
    let tailV4: number[] | null = null;
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (v4) {
      tailV4 = v4[1].split('.').map(Number);
      head = addr.substring(0, addr.length - v4[1].length) + '0:0';
    }
    const [left, right] = head.includes('::') ? head.split('::') : [head, null];
    const l = left ? left.split(':').filter((x) => x !== '') : [];
    const r = right !== null && right ? right.split(':').filter((x) => x !== '') : [];
    const missing = 8 - (l.length + r.length);
    const groups = right !== null ? [...l, ...Array(missing).fill('0'), ...r] : l;
    if (groups.length !== 8) return null;
    let n = groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n);
    if (tailV4) {
      n = (n >> 32n) << 32n;
      n += BigInt(((tailV4[0] << 24) >>> 0) + (tailV4[1] << 16) + (tailV4[2] << 8) + tailV4[3]);
    }
    return { v: 6, n };
  }
  return null;
}

export interface ParsedCidr {
  v: 4 | 6;
  network: bigint;
  prefix: number;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const [addr, prefixRaw] = cidr.trim().split('/');
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = ip.v === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { v: ip.v, network: ip.n & mask, prefix };
}

export function ipInCidr(ip: string, cidr: string | ParsedCidr): boolean {
  const parsed = typeof cidr === 'string' ? parseCidr(cidr) : cidr;
  const addr = parseIp(ip);
  if (!parsed || !addr || parsed.v !== addr.v) return false;
  const bits = addr.v === 4 ? 32 : 128;
  const mask = parsed.prefix === 0 ? 0n : ((1n << BigInt(parsed.prefix)) - 1n) << BigInt(bits - parsed.prefix);
  return (addr.n & mask) === parsed.network;
}

export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null;
}
