import { Injectable, Logger, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { AuthProvider, RoleKey } from '@prisma/client';
import { Client } from 'ldapts';
import { AppConfigService } from '../config/app-config.service';

/** RFC 4515 filter value escaping. */
export function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

const ROLE_KEYS = Object.values(RoleKey) as string[];

export interface LdapIdentity {
  provider: AuthProvider;
  externalId: string;
  email: string;
  displayName: string;
  role: RoleKey;
  roleFromGroups: boolean;
}

/** LDAP / Active Directory authentication (service-account search + user bind). */
@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.ldapConfigured;
  }

  private newClient(): Client {
    const cfg = this.config.ldap;
    return new Client({
      url: cfg.url,
      timeout: 10_000,
      connectTimeout: 10_000,
      tlsOptions: cfg.url.startsWith('ldaps://') ? { rejectUnauthorized: cfg.tlsRejectUnauthorized } : undefined,
    });
  }

  async authenticate(username: string, password: string): Promise<LdapIdentity> {
    if (!this.enabled) throw new UnprocessableEntityException('LDAP authentication is not configured');
    if (!password) throw new UnauthorizedException('Invalid username or password');
    const cfg = this.config.ldap;
    const client = this.newClient();
    let entry: Record<string, unknown> | undefined;
    try {
      if (cfg.bindDn) await client.bind(cfg.bindDn, cfg.bindPassword);
      const filter = cfg.searchFilter.split('{{username}}').join(escapeLdapFilter(username.trim()));
      const { searchEntries } = await client.search(cfg.searchBase, {
        scope: 'sub',
        filter,
        sizeLimit: 2,
        attributes: ['dn', 'mail', 'userPrincipalName', 'displayName', 'cn', 'memberOf', 'objectGUID', 'entryUUID', 'sAMAccountName', 'uid'],
        explicitBufferAttributes: ['objectGUID'],
      });
      if (searchEntries.length !== 1) throw new UnauthorizedException('Invalid username or password');
      entry = searchEntries[0] as Record<string, unknown>;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.error(`LDAP search failed: ${(e as Error).message}`);
      throw new UnauthorizedException('Directory authentication failed');
    } finally {
      await client.unbind().catch(() => undefined);
    }

    const dn = String(entry.dn);
    const userClient = this.newClient();
    try {
      await userClient.bind(dn, password);
    } catch {
      throw new UnauthorizedException('Invalid username or password');
    } finally {
      await userClient.unbind().catch(() => undefined);
    }

    const first = (v: unknown): string | undefined =>
      Array.isArray(v) ? (v.length ? String(v[0]) : undefined) : v != null && v !== '' ? String(v) : undefined;
    const groups = ([] as unknown[]).concat(entry.memberOf ?? []).map(String);
    const guid = entry.objectGUID instanceof Buffer ? entry.objectGUID.toString('hex') : first(entry.entryUUID);
    const email = first(entry.mail) ?? first(entry.userPrincipalName) ?? `${username}@ldap.local`;

    let role: RoleKey = ROLE_KEYS.includes(cfg.defaultRole) ? cfg.defaultRole : 'EMPLOYEE';
    let roleFromGroups = false;
    const map = Object.entries(cfg.groupRoleMap);
    const rank = ROLE_KEYS; // ordered most → least privileged
    for (const [groupDn, mapped] of map) {
      if (!ROLE_KEYS.includes(mapped)) continue;
      if (groups.some((g) => g.toLowerCase() === groupDn.toLowerCase())) {
        if (!roleFromGroups || rank.indexOf(mapped) < rank.indexOf(role)) role = mapped as RoleKey;
        roleFromGroups = true;
      }
    }
    const isAd = /samaccountname/i.test(cfg.searchFilter);
    return {
      provider: isAd ? 'ACTIVE_DIRECTORY' : 'LDAP',
      externalId: guid ?? dn,
      email,
      displayName: first(entry.displayName) ?? first(entry.cn) ?? username,
      role,
      // With a group map configured the directory is authoritative for roles.
      roleFromGroups: map.length > 0,
    };
  }
}
