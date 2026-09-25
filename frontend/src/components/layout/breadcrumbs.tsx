"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { findNavItem, navLabel } from "@/components/layout/nav";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/format";

const BreadcrumbCtx = React.createContext<{ extra: Record<string, string>; set: (path: string, label: string | null) => void }>({
  extra: {},
  set: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [extra, setExtra] = React.useState<Record<string, string>>({});
  const set = React.useCallback((path: string, label: string | null) => {
    setExtra((prev) => {
      if (label === null) {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      }
      if (prev[path] === label) return prev;
      return { ...prev, [path]: label };
    });
  }, []);
  const value = React.useMemo(() => ({ extra, set }), [extra, set]);
  return <BreadcrumbCtx.Provider value={value}>{children}</BreadcrumbCtx.Provider>;
}

/** Detail pages call this to replace an id segment with a readable label. */
export function useBreadcrumbLabel(label: string | undefined | null) {
  const pathname = usePathname();
  const { set } = React.useContext(BreadcrumbCtx);
  React.useEffect(() => {
    if (!label) return;
    set(pathname, label);
    return () => set(pathname, null);
  }, [pathname, label, set]);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { extra } = React.useContext(BreadcrumbCtx);
  const { user } = useAuth();
  const item = findNavItem(pathname);
  const crumbs: { href: string; label: string }[] = [];
  if (item) {
    crumbs.push({ href: item.href, label: navLabel(item, user?.role) });
    const rest = pathname.slice(item.href.length).split("/").filter(Boolean);
    let acc = item.href;
    for (const seg of rest) {
      acc += `/${seg}`;
      const looksLikeId = /^[0-9a-f-]{16,}$/i.test(seg) || /^\d+$/.test(seg);
      crumbs.push({ href: acc, label: extra[acc] ?? (looksLikeId ? "Details" : humanize(seg)) });
    }
  }
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
              {last ? (
                <span className="truncate font-medium" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
