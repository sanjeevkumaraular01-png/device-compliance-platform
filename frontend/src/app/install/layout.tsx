import type { Metadata } from "next";

// Standalone public route: it lives OUTSIDE the (app) and (auth) route groups, so it inherits
// only the root <Providers> (theme, query client, toaster) — no console shell, no sidebar and,
// crucially, no authentication gate. Employees reach it without a SecureEndpoint account.
export const metadata: Metadata = {
  title: "Install the agent",
  description: "Set up SecureEndpoint on your Windows device by signing in with your company email.",
};

export default function InstallLayout({ children }: { children: React.ReactNode }) {
  return children;
}
