/** Demo-only app mixes per department code (process names / domains as agents report them). */
export type DemoAppPick = { app: string; domain?: string; weight: number };

export const DEMO_APP_MIX: Record<string, DemoAppPick[]> = {
  ENG: [
    { app: 'Code', weight: 30 }, { app: 'chrome', domain: 'github.com', weight: 12 }, { app: 'WindowsTerminal', weight: 10 },
    { app: 'chrome', domain: 'acme.atlassian.net', weight: 8 }, { app: 'slack', weight: 8 }, { app: 'Teams', weight: 8 },
    { app: 'chrome', domain: 'stackoverflow.com', weight: 5 }, { app: 'Postman', weight: 4 }, { app: 'chrome', domain: 'youtube.com', weight: 2 },
    { app: 'explorer', weight: 2 },
  ],
  SALES: [
    { app: 'chrome', domain: 'acme.lightning.force.com', weight: 22 }, { app: 'OUTLOOK', weight: 16 }, { app: 'chrome', domain: 'web.whatsapp.com', weight: 12 },
    { app: 'Zoom', weight: 12 }, { app: 'EXCEL', weight: 8 }, { app: 'chrome', domain: 'app.hubspot.com', weight: 8 }, { app: 'chrome', domain: 'linkedin.com', weight: 6 },
    { app: 'chrome', domain: 'instagram.com', weight: 2 },
  ],
  FIN: [{ app: 'EXCEL', weight: 35 }, { app: 'OUTLOOK', weight: 15 }, { app: 'chrome', domain: 'books.zoho.in', weight: 12 }, { app: 'Teams', weight: 8 }, { app: 'WINWORD', weight: 6 }, { app: 'explorer', weight: 4 }],
  HR: [{ app: 'OUTLOOK', weight: 20 }, { app: 'WINWORD', weight: 14 }, { app: 'chrome', domain: 'linkedin.com', weight: 14 }, { app: 'Teams', weight: 14 }, { app: 'EXCEL', weight: 8 }, { app: 'chrome', domain: 'docs.google.com', weight: 6 }],
  OPS: [{ app: 'EXCEL', weight: 18 }, { app: 'OUTLOOK', weight: 16 }, { app: 'chrome', domain: 'acme.freshdesk.com', weight: 14 }, { app: 'Teams', weight: 10 }, { app: 'chrome', domain: 'netflix.com', weight: 2 }],
  LEGAL: [{ app: 'WINWORD', weight: 30 }, { app: 'OUTLOOK', weight: 18 }, { app: 'chrome', domain: 'docs.google.com', weight: 8 }, { app: 'Teams', weight: 8 }, { app: 'AcroRd32', weight: 8 }],
  IT: [
    { app: 'chrome', domain: 'acme.zendesk.com', weight: 16 }, { app: 'WindowsTerminal', weight: 14 }, { app: 'chrome', domain: 'whmcs.acme.com', weight: 10 },
    { app: 'chrome', domain: 'portal.azure.com', weight: 10 }, { app: 'Teams', weight: 8 }, { app: 'OUTLOOK', weight: 8 }, { app: 'mstsc', weight: 6 },
  ],
};

