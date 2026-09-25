import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { AlertChannelType } from '@prisma/client';
import { createHmac } from 'crypto';
import * as nodemailer from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';

export interface NotificationMessage {
  title: string;
  message: string;
  severity: string;
  category: string;
  alertId?: string;
  deviceName?: string | null;
  url?: string;
  occurredAt?: string;
}

export interface ChannelConfig {
  recipients?: string[];
  to?: string[];
  provider?: string;
  webhookUrl?: string;
  url?: string;
  secret?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#B91C1C',
  HIGH: '#EA580C',
  MEDIUM: '#CA8A04',
  LOW: '#2563EB',
  INFO: '#6B7280',
};

/** Sends notifications over EMAIL / SMS / WHATSAPP (Twilio) / SLACK / TEAMS / WEBHOOK. */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** Throws 422 if the channel type cannot work with the current server configuration. */
  assertAvailable(type: AlertChannelType): void {
    if (type === 'EMAIL' && !this.config.smtpConfigured) {
      throw new UnprocessableEntityException('Email delivery is not configured (set SMTP_HOST / SMTP_* on the server)');
    }
    if (type === 'SMS' && !this.config.twilioSmsConfigured) {
      throw new UnprocessableEntityException('SMS delivery is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)');
    }
    if (type === 'WHATSAPP' && !this.config.twilioWhatsappConfigured) {
      throw new UnprocessableEntityException('WhatsApp delivery is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)');
    }
  }

  validateConfig(type: AlertChannelType, cfg: ChannelConfig): string[] {
    const errors: string[] = [];
    const isUrl = (u: unknown) => {
      try {
        const x = new URL(String(u));
        return x.protocol === 'https:' || x.protocol === 'http:';
      } catch {
        return false;
      }
    };
    const phoneList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((p) => typeof p === 'string' && /^\+?[1-9]\d{6,15}$/.test(p));
    switch (type) {
      case 'EMAIL':
        if (!Array.isArray(cfg.recipients) || !cfg.recipients.length || !cfg.recipients.every((r) => typeof r === 'string' && /^[^@\s]+@[^@\s]+$/.test(r))) {
          errors.push('config.recipients must be a non-empty array of email addresses');
        }
        break;
      case 'SMS':
      case 'WHATSAPP':
        if (!phoneList(cfg.to)) errors.push('config.to must be a non-empty array of E.164 phone numbers');
        break;
      case 'SLACK':
      case 'TEAMS':
        if (!isUrl(cfg.webhookUrl)) errors.push('config.webhookUrl must be a valid URL');
        break;
      case 'WEBHOOK':
        if (!isUrl(cfg.url)) errors.push('config.url must be a valid URL');
        if (cfg.secret !== undefined && typeof cfg.secret !== 'string') errors.push('config.secret must be a string');
        break;
    }
    return errors;
  }

  async send(type: AlertChannelType, cfg: ChannelConfig, msg: NotificationMessage): Promise<void> {
    this.assertAvailable(type);
    switch (type) {
      case 'EMAIL':
        return this.sendEmail(cfg.recipients ?? [], msg);
      case 'SMS':
        return this.sendTwilio(cfg.to ?? [], msg, false);
      case 'WHATSAPP':
        return this.sendTwilio(cfg.to ?? [], msg, true);
      case 'SLACK':
        return this.postJson(cfg.webhookUrl!, this.slackPayload(msg));
      case 'TEAMS':
        return this.postJson(cfg.webhookUrl!, this.teamsPayload(msg));
      case 'WEBHOOK':
        return this.sendWebhook(cfg.url!, cfg.secret, msg);
    }
  }

  private text(msg: NotificationMessage): string {
    return `[${msg.severity}] ${msg.title}${msg.deviceName ? ` — ${msg.deviceName}` : ''}\n${msg.message}${msg.url ? `\n${msg.url}` : ''}`;
  }

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const s = this.config.smtp;
      this.transporter = nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: s.user ? { user: s.user, pass: s.password } : undefined,
        connectionTimeout: 15_000,
      });
    }
    return this.transporter;
  }

  async sendEmail(recipients: string[], msg: NotificationMessage, attachments?: { filename: string; path: string }[]): Promise<void> {
    const color = SEVERITY_COLOR[msg.severity] ?? '#374151';
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    await this.getTransporter().sendMail({
      from: this.config.smtp.from,
      to: recipients.join(', '),
      subject: `[SecureEndpoint][${msg.severity}] ${msg.title}`,
      text: this.text(msg),
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px">
<div style="border-left:6px solid ${color};padding:12px 16px;background:#F9FAFB">
<div style="font-size:12px;color:${color};font-weight:700">${esc(msg.severity)} · ${esc(msg.category)}</div>
<h2 style="margin:6px 0">${esc(msg.title)}</h2>
${msg.deviceName ? `<div style="color:#374151">Device: <b>${esc(msg.deviceName)}</b></div>` : ''}
<p style="color:#111827">${esc(msg.message)}</p>
${msg.url ? `<a href="${esc(msg.url)}" style="color:#2563EB">Open in SecureEndpoint Manager</a>` : ''}
</div><p style="font-size:11px;color:#9CA3AF">SecureEndpoint Manager automated notification</p></div>`,
      attachments,
    });
  }

  private async sendTwilio(to: string[], msg: NotificationMessage, whatsapp: boolean): Promise<void> {
    const t = this.config.twilio;
    const from = whatsapp ? `whatsapp:${t.whatsappFrom.replace(/^whatsapp:/, '')}` : t.fromNumber;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`;
    const auth = Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64');
    const body = this.text(msg).substring(0, 1500);
    for (const number of to) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: whatsapp ? `whatsapp:${number}` : number, From: from, Body: body }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Twilio responded ${res.status}: ${detail.substring(0, 200)}`);
      }
    }
  }

  private slackPayload(msg: NotificationMessage) {
    return {
      text: this.text(msg),
      attachments: [
        {
          color: SEVERITY_COLOR[msg.severity] ?? '#374151',
          title: msg.title,
          title_link: msg.url,
          text: msg.message,
          fields: [
            { title: 'Severity', value: msg.severity, short: true },
            { title: 'Category', value: msg.category, short: true },
            ...(msg.deviceName ? [{ title: 'Device', value: msg.deviceName, short: true }] : []),
          ],
          footer: 'SecureEndpoint Manager',
        },
      ],
    };
  }

  private teamsPayload(msg: NotificationMessage) {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: msg.title,
      themeColor: (SEVERITY_COLOR[msg.severity] ?? '#374151').replace('#', ''),
      title: `[${msg.severity}] ${msg.title}`,
      sections: [
        {
          text: msg.message,
          facts: [
            { name: 'Category', value: msg.category },
            ...(msg.deviceName ? [{ name: 'Device', value: msg.deviceName }] : []),
            ...(msg.occurredAt ? [{ name: 'Time', value: msg.occurredAt }] : []),
          ],
        },
      ],
      potentialAction: msg.url
        ? [{ '@type': 'OpenUri', name: 'Open in SecureEndpoint Manager', targets: [{ os: 'default', uri: msg.url }] }]
        : [],
    };
  }

  private async postJson(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Webhook responded ${res.status}: ${detail.substring(0, 200)}`);
    }
  }

  private async sendWebhook(url: string, secret: string | undefined, msg: NotificationMessage): Promise<void> {
    const payload = { event: 'alert', timestamp: new Date().toISOString(), alert: msg };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'User-Agent': 'SecureEndpoint-Manager/1.0' };
    if (secret) headers['X-SEM-Signature'] = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }
}
