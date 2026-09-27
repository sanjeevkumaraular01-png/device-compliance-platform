import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

export interface ImapOptions {
  host: string;
  port: number;
  secure: boolean;
  allowInsecureTls?: boolean; // labs/self-signed test servers only
}

export type VerifyResult = 'OK' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE';

/**
 * Verifies a company email + password by performing an IMAP LOGIN against the
 * company mail server. The password is used once for the login and never
 * stored. A successful login only proves the person controls that mailbox.
 */
@Injectable()
export class MailVerifier {
  private readonly logger = new Logger(MailVerifier.name);

  async verify(email: string, password: string, opts: ImapOptions): Promise<VerifyResult> {
    if (!opts.host) return 'UNAVAILABLE';
    const client = new ImapFlow({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: { user: email, pass: password },
      logger: false,
      // 10s so a slow/unreachable mail server fails fast rather than hanging the request.
      socketTimeout: 10_000,
      greetingTimeout: 8_000,
      connectionTimeout: 8_000,
      tls: opts.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await client.connect();
      await client.logout().catch(() => undefined);
      return 'OK';
    } catch (e) {
      const err = e as { authenticationFailed?: boolean; responseStatus?: string; code?: string; message?: string };
      // imapflow sets authenticationFailed on a rejected LOGIN; anything else is a
      // connectivity/TLS problem we must not report as "wrong password".
      if (err.authenticationFailed || err.responseStatus === 'NO') {
        return 'INVALID_CREDENTIALS';
      }
      this.logger.warn(`IMAP verify unavailable for ${opts.host}:${opts.port}: ${err.code ?? err.message ?? 'error'}`);
      return 'UNAVAILABLE';
    } finally {
      try {
        client.close();
      } catch {
        /* already closed */
      }
    }
  }
}
