# SecureEndpoint Manager — Admin Console

Next.js 15 (App Router, standalone output) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Radix/shadcn-style components · TanStack Query + Table · Recharts · react-hook-form + zod.

The console is a pure client of the NestJS REST API documented in [`../docs/API.md`](../docs/API.md).
All requests go to the relative path `/api/v1/...`.

## Run

```bash
cp .env.example .env.local        # API_INTERNAL_URL=http://localhost:4000
npm install
npm run dev                       # http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build (`.next/standalone`) |
| `npm start` | Serve the production build on port 3000 |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | `tsc --noEmit` |

### API routing

`next.config.ts` rewrites `/api/:path*` → `${API_INTERNAL_URL}/api/:path*` (default `http://localhost:4000`).
Rewrites are resolved **at build time**, so the Docker image receives the backend URL as a build arg.
In production Nginx normally routes `/api/` straight to the backend and the rewrite is only a fallback.

### Docker

```bash
docker build -t sem-frontend --build-arg API_INTERNAL_URL=http://backend:4000 .
docker run -p 3000:3000 sem-frontend
```

Multi-stage (`node:22-alpine`), runs `server.js` from the standalone output as the non-root `nextjs` user on port 3000.

## Authentication

| Concern | Implementation (`src/lib/api.ts`, `src/lib/auth.tsx`) |
|---|---|
| Login | `POST /auth/login` (email) or `POST /auth/ldap/login` (LDAP / Active Directory tab) |
| SSO | Buttons rendered only for providers returned by `GET /auth/sso/providers`; the backend redirects to `/auth/callback#accessToken=…&refreshToken=…` (or `#mfaToken=…`), which the callback page consumes and strips from the URL |
| MFA | `mfaRequired: true` → `mfaToken` kept in `sessionStorage` → `/login/mfa` (6-digit TOTP or recovery code) → `POST /auth/mfa/verify` |
| Token storage | Access token in memory (+ `sessionStorage` fallback for reloads); refresh token in `localStorage` |
| Refresh | Any 401 triggers a **single-flight** `POST /auth/refresh` (concurrent requests share one refresh), then the original request is retried once. A rejected refresh clears tokens and returns to `/login` |
| MFA enrolment | Header `X-MFA-Enrollment-Required: true` on any response → redirect to `/settings?tab=security&enroll=1` with a persistent banner |
| Route protection | Client-side: the `(app)` layout (`AppShell`) redirects unauthenticated users to `/login?next=…`; tokens are not cookies, so there is no middleware |
| Logout | `POST /auth/logout { refreshToken }`, local tokens cleared, query cache wiped |

### RBAC

`GET /auth/me` returns `permissions: string[]`.

- `usePermission("devices:write")` / `useAuth().can([...])` and `<Can permission="…">` hide actions.
- Navigation items declare required permissions (`src/components/layout/nav.ts`); hidden items are also
  enforced as routes — the shell renders a friendly 403 page if the user opens a URL they cannot use.
- Employees get "My Devices", a personal dashboard, and "USB Access" (temporary access requests).

## Structure

```
src/
  app/
    (auth)/login, (auth)/login/mfa, (auth)/auth/callback      # public pages, split-screen layout
    (app)/…                                                    # authenticated console (AppShell layout)
      dashboard, devices, devices/[id], enrollment, policies, policies/[id], compliance,
      security, patches, usb, software, alerts, reports, audit, users, departments, roles, settings
  components/
    ui/          # hand-written shadcn-style primitives (Radix + cva + tailwind-merge)
    layout/      # AppShell, Sidebar (collapsible; Sheet on mobile), Topbar, Breadcrumbs, ⌘K CommandPalette
    data-table/  # DataTable (server/client pagination, sorting, selection, column toggle), filters, pagination
    charts/      # Recharts wrappers (area, donut, bar, line, sparkline) with themed tooltip
    common/      # status badges, score ring, OS icons, KPI cards, empty/error/403 states, confirm dialog
    <feature>/   # page-specific components (devices, policies, alerts, …)
  hooks/         # useListQuery (server lists), useApiMutation (toasts + invalidation), lookups, debounce
  lib/           # api.ts (fetch client), auth.tsx, query.ts, status.ts (severity colours), format.ts, utils.ts
  types/api.ts   # TypeScript mirror of API.md + Prisma enums
```

### Design system

- Theme tokens are CSS variables in `src/app/globals.css` (shadcn names plus `--success`, `--warning`,
  `--critical`, `--info` and the severity scale `--sev-*`). Dark is the default; light and system are supported.
- Severity colours are centralised in `src/lib/status.ts`: CRITICAL red, HIGH orange, MEDIUM amber, LOW blue,
  NONE/COMPLIANT green, UNKNOWN grey. Every badge, chart and progress bar reads from there.
- Every page has skeleton loading states, empty states, error states with retry, toasts for mutations and
  confirmation dialogs for destructive actions.
