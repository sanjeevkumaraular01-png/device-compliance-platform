import { ipInCidr, isValidCidr, parseIp } from './cidr';

describe('CIDR matching', () => {
  it('matches IPv4 ranges', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.1.2.3', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('192.168.1.77', '192.168.1.64/27')).toBe(true);
    expect(ipInCidr('192.168.1.96', '192.168.1.64/27')).toBe(false);
    expect(ipInCidr('203.0.113.9', '203.0.113.9')).toBe(true);
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
  });

  it('handles IPv4-mapped IPv6 client addresses', () => {
    expect(ipInCidr('::ffff:10.0.0.5', '10.0.0.0/24')).toBe(true);
  });

  it('matches IPv6 ranges', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('::1', '::1/128')).toBe(true);
    expect(ipInCidr('10.0.0.1', '::/0')).toBe(false);
  });

  it('validates CIDR strings', () => {
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidCidr('fe80::/10')).toBe(true);
    expect(isValidCidr('not-an-ip')).toBe(false);
    expect(parseIp('999.1.1.1')).toBeNull();
  });
});
