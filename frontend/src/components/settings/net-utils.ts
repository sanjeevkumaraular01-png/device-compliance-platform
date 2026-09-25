function isIPv4(addr: string): boolean {
  const parts = addr.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === "0" || !p.startsWith("0")));
}

function isIPv6(addr: string): boolean {
  let a = addr;
  if (!a.includes(":")) return false;
  // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1) counts as two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) {
    if (!isIPv4(v4[1])) return false;
    a = a.slice(0, a.length - v4[1].length) + "0:0";
  }
  const doubles = a.split("::").length - 1;
  if (doubles > 1) return false;
  const hex = /^[0-9a-fA-F]{1,4}$/;
  if (doubles === 1) {
    const [left, right] = a.split("::");
    const l = left ? left.split(":") : [];
    const r = right ? right.split(":") : [];
    if (![...l, ...r].every((g) => hex.test(g))) return false;
    return l.length + r.length <= 7;
  }
  const groups = a.split(":");
  return groups.length === 8 && groups.every((g) => hex.test(g));
}

/** Validates an IPv4/IPv6 CIDR (a bare address is treated as a single-host rule, like the backend). */
export function validateCidr(value: string): string | null {
  const v = value.trim();
  if (!v) return "CIDR is required";
  const [addr, prefix, ...rest] = v.split("/");
  if (rest.length) return "Invalid CIDR";
  const v4 = isIPv4(addr);
  const v6 = !v4 && isIPv6(addr);
  if (!v4 && !v6) return "Enter a valid IPv4 or IPv6 address";
  if (prefix !== undefined) {
    if (!/^\d{1,3}$/.test(prefix)) return "Prefix length must be a number";
    const max = v4 ? 32 : 128;
    if (Number(prefix) > max) return `Prefix length must be between 0 and ${max}`;
  }
  return null;
}

/** Rough "Browser on OS" from a user agent string. */
export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string; mobile: boolean } {
  if (!ua) return { browser: "Unknown browser", os: "Unknown OS", mobile: false };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua) || /CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl\//i.test(ua)
              ? "curl"
              : "Unknown browser";
  const os = /Windows NT/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown OS";
  return { browser, os, mobile: /Mobi|iPhone|Android/.test(ua) };
}
