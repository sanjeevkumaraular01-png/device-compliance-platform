import type { ActivityCategory, AppRuleKind, MatchType } from '@prisma/client';

export interface DefaultAppRule {
  kind: AppRuleKind;
  pattern: string;
  matchType: MatchType;
  label: string;
  category: ActivityCategory;
  /** Department code for department-specific overrides (null = global). */
  departmentCode?: string;
}

const app = (pattern: string, label: string, category: ActivityCategory, matchType: MatchType = 'CONTAINS'): DefaultAppRule => ({ kind: 'APP', pattern, matchType, label, category });
const web = (pattern: string, label: string, category: ActivityCategory, matchType: MatchType = 'EXACT'): DefaultAppRule => ({ kind: 'WEBSITE', pattern, matchType, label, category });

/** Seeded productivity catalog (editable in Workforce → Settings → App & website categories). */
export const DEFAULT_APP_RULES: DefaultAppRule[] = [
  // ── Productive applications ──
  app('^(code|code\\.exe|code - insiders|visual studio code)$', 'VS Code', 'PRODUCTIVE', 'REGEX'),
  app('devenv', 'Visual Studio', 'PRODUCTIVE'),
  app('idea', 'IntelliJ IDEA', 'PRODUCTIVE'),
  app('pycharm', 'PyCharm', 'PRODUCTIVE'),
  app('postman', 'Postman', 'PRODUCTIVE'),
  app('docker', 'Docker', 'PRODUCTIVE'),
  app('^(windowsterminal|terminal|iterm2|gnome-terminal|konsole|powershell|pwsh|cmd|wezterm|alacritty)(\\.exe)?$', 'Terminal', 'PRODUCTIVE', 'REGEX'),
  app('githubdesktop', 'GitHub Desktop', 'PRODUCTIVE'),
  app('outlook', 'Outlook', 'PRODUCTIVE'),
  app('excel', 'Excel', 'PRODUCTIVE'),
  app('winword', 'Word', 'PRODUCTIVE'),
  app('microsoft word', 'Word', 'PRODUCTIVE'),
  app('powerpnt', 'PowerPoint', 'PRODUCTIVE'),
  app('microsoft powerpoint', 'PowerPoint', 'PRODUCTIVE'),
  app('photoshop', 'Photoshop', 'PRODUCTIVE'),
  app('figma', 'Figma', 'PRODUCTIVE'),
  app('slack', 'Slack', 'PRODUCTIVE'),
  app('notion', 'Notion', 'PRODUCTIVE'),
  // ── Meetings (label prefix "Meeting:" => meeting time, never idle) ──
  app('teams', 'Meeting: Teams', 'PRODUCTIVE'),
  app('zoom', 'Meeting: Zoom', 'PRODUCTIVE'),
  app('webex', 'Meeting: Webex', 'PRODUCTIVE'),
  app('skype', 'Meeting: Skype', 'PRODUCTIVE'),
  // ── Neutral applications (browsers without a domain, OS tools) ──
  app('chrome', 'Chrome', 'NEUTRAL'),
  app('msedge', 'Edge', 'NEUTRAL'),
  app('firefox', 'Firefox', 'NEUTRAL'),
  app('safari', 'Safari', 'NEUTRAL', 'EXACT'),
  app('explorer', 'File Explorer', 'NEUTRAL'),
  app('finder', 'Finder', 'NEUTRAL', 'EXACT'),
  app('^(systemsettings|system settings|system preferences|gnome-control-center)(\\.exe)?$', 'Settings', 'NEUTRAL', 'REGEX'),
  app('whatsapp', 'WhatsApp', 'NEUTRAL'),
  app('spotify', 'Spotify', 'NEUTRAL'),
  // ── Unproductive applications ──
  app('steam', 'Games: Steam', 'UNPRODUCTIVE'),
  app('epicgameslauncher', 'Games: Epic', 'UNPRODUCTIVE'),
  app('solitaire', 'Games: Solitaire', 'UNPRODUCTIVE'),
  app('minecraft', 'Games: Minecraft', 'UNPRODUCTIVE'),
  // ── Blocked applications ──
  app('(utorrent|bittorrent|qbittorrent|transmission-qt|vuze)', 'Torrent client', 'BLOCKED', 'REGEX'),

  // ── Productive websites ──
  web('github.com', 'GitHub', 'PRODUCTIVE'),
  web('gitlab.com', 'GitLab', 'PRODUCTIVE'),
  web('atlassian.net', 'Jira / Confluence', 'PRODUCTIVE'),
  web('jira', 'Jira', 'PRODUCTIVE', 'CONTAINS'),
  web('confluence', 'Confluence', 'PRODUCTIVE', 'CONTAINS'),
  web('outlook.office.com', 'Outlook', 'PRODUCTIVE'),
  web('office.com', 'Microsoft 365', 'PRODUCTIVE'),
  web('docs.google.com', 'Google Docs', 'PRODUCTIVE'),
  web('mail.google.com', 'Gmail', 'PRODUCTIVE'),
  web('figma.com', 'Figma', 'PRODUCTIVE'),
  web('whmcs', 'WHMCS', 'PRODUCTIVE', 'CONTAINS'),
  web('zendesk.com', 'Zendesk', 'PRODUCTIVE'),
  web('freshdesk.com', 'Freshdesk', 'PRODUCTIVE'),
  web('salesforce.com', 'Salesforce', 'PRODUCTIVE'),
  web('force.com', 'Salesforce', 'PRODUCTIVE'),
  web('hubspot.com', 'HubSpot', 'PRODUCTIVE'),
  web('zoho', 'Zoho CRM', 'PRODUCTIVE', 'CONTAINS'),
  web('slack.com', 'Slack', 'PRODUCTIVE'),
  web('notion.so', 'Notion', 'PRODUCTIVE'),
  web('stackoverflow.com', 'Stack Overflow', 'PRODUCTIVE'),
  web('portal.azure.com', 'Azure Portal', 'PRODUCTIVE'),
  web('console.aws.amazon.com', 'AWS Console', 'PRODUCTIVE'),
  // ── Meeting websites ──
  web('meet.google.com', 'Meeting: Google Meet', 'PRODUCTIVE'),
  web('teams.microsoft.com', 'Meeting: Teams', 'PRODUCTIVE'),
  web('zoom.us', 'Meeting: Zoom', 'PRODUCTIVE'),
  web('webex.com', 'Meeting: Webex', 'PRODUCTIVE'),
  // ── Neutral websites ──
  web('web.whatsapp.com', 'WhatsApp Web', 'NEUTRAL'),
  { ...web('web.whatsapp.com', 'WhatsApp Web', 'PRODUCTIVE'), departmentCode: 'SALES' },
  web('google.com', 'Google Search', 'NEUTRAL'),
  web('linkedin.com', 'LinkedIn', 'NEUTRAL'),
  web('wikipedia.org', 'Wikipedia', 'NEUTRAL'),
  // ── Unproductive websites ──
  web('youtube.com', 'YouTube', 'UNPRODUCTIVE'),
  web('netflix.com', 'Netflix', 'UNPRODUCTIVE'),
  web('instagram.com', 'Instagram', 'UNPRODUCTIVE'),
  web('facebook.com', 'Facebook', 'UNPRODUCTIVE'),
  web('twitter.com', 'Twitter / X', 'UNPRODUCTIVE'),
  web('x.com', 'Twitter / X', 'UNPRODUCTIVE'),
  web('reddit.com', 'Reddit', 'UNPRODUCTIVE'),
  web('primevideo.com', 'Prime Video', 'UNPRODUCTIVE'),
  web('hotstar.com', 'Hotstar', 'UNPRODUCTIVE'),
  web('twitch.tv', 'Twitch', 'UNPRODUCTIVE'),
  web('(^|\\.)(miniclip|poki|crazygames|friv|chess)\\.com$', 'Online games', 'UNPRODUCTIVE', 'REGEX'),
  // ── Blocked websites ──
  web('(torrent|thepiratebay|1337x|rarbg|yts\\.mx|nyaa\\.si)', 'Torrent sites', 'BLOCKED', 'REGEX'),
  web('(bet365|betway|1xbet|dafabet|parimatch|casino|poker|betting|gambling)', 'Betting / casino', 'BLOCKED', 'REGEX'),
];
