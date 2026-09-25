import { CheckCircle2, Fingerprint, Laptop, ShieldCheck } from "lucide-react";
import { BrandMark, ShieldLogo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const highlights = [
  { icon: Laptop, title: "Unified endpoint inventory", text: "Windows, macOS and Linux devices with live hardware and software telemetry." },
  { icon: ShieldCheck, title: "Continuous compliance", text: "Policy-driven scoring for encryption, EDR, firewall, patches and USB control." },
  { icon: Fingerprint, title: "Zero-trust access", text: "MFA, SSO, role-based permissions and a tamper-evident audit trail." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden border-r bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_20%_10%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_45%),radial-gradient(circle_at_90%_85%,color-mix(in_oklab,var(--chart-2)_18%,transparent),transparent_40%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--foreground)_1px,transparent_1px),linear-gradient(90deg,var(--foreground)_1px,transparent_1px)] [background-size:36px_36px]"
        />
        <BrandMark className="relative" />
        <div className="relative max-w-md">
          <ShieldLogo className="mb-6 size-12" />
          <h2 className="text-2xl font-semibold tracking-tight">Every endpoint. Verified, compliant and protected.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The SecureEndpoint Manager console gives security and IT teams one place to enforce policy and prove compliance.
          </p>
          <ul className="mt-8 grid gap-5">
            {highlights.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-primary">
                  <h.icon className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">{h.title}</div>
                  <div className="text-xs text-muted-foreground">{h.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-sev-none" /> Access is monitored and recorded in the audit log.
        </div>
      </aside>
      <main id="main" className="relative flex min-h-dvh flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <BrandMark className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <footer className="px-4 pb-4 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} SecureEndpoint Manager · Authorized use only
        </footer>
      </main>
    </div>
  );
}
