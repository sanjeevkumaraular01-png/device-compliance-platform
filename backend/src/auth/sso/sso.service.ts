import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthProvider, RoleKey } from '@prisma/client';
import { BaseClient, generators, Issuer } from 'openid-client';
import { AppConfigService } from '../../config/app-config.service';
import { CacheService } from '../../redis/redis.module';

export type SsoProviderId = 'azure-ad' | 'oidc';

interface SsoState {
  provider: SsoProviderId;
  nonce: string;
  codeVerifier: string;
}

export interface SsoIdentity {
  provider: AuthProvider;
  externalId: string;
  email: string;
  displayName: string;
  role: RoleKey;
  roleFromGroups: boolean;
}

const ROLE_KEYS = Object.values(RoleKey) as string[];

/** Azure AD (Microsoft identity platform v2) + generic OIDC via openid-client. */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly clients = new Map<SsoProviderId, Promise<BaseClient>>();

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CacheService,
  ) {}

  providers() {
    const base = `${this.config.apiPublicUrl}/api/v1/auth/sso`;
    const list: { id: SsoProviderId; name: string; loginUrl: string }[] = [];
    if (this.config.azureAdConfigured) list.push({ id: 'azure-ad', name: 'Microsoft Entra ID', loginUrl: `${base}/azure-ad/login` });
    if (this.config.oidcConfigured) list.push({ id: 'oidc', name: 'Single Sign-On', loginUrl: `${base}/oidc/login` });
    return list;
  }

  private isConfigured(id: SsoProviderId): boolean {
    return id === 'azure-ad' ? this.config.azureAdConfigured : this.config.oidcConfigured;
  }

  private redirectUri(id: SsoProviderId): string {
    return id === 'azure-ad' ? this.config.azureAd.redirectUri : this.config.oidc.redirectUri;
  }

  private getClient(id: SsoProviderId): Promise<BaseClient> {
    if (!this.isConfigured(id)) throw new NotFoundException('SSO provider is not configured');
    let p = this.clients.get(id);
    if (!p) {
      p = (async () => {
        if (id === 'azure-ad') {
          const a = this.config.azureAd;
          const issuer = await Issuer.discover(`https://login.microsoftonline.com/${a.tenantId}/v2.0`);
          return new issuer.Client({
            client_id: a.clientId,
            client_secret: a.clientSecret,
            redirect_uris: [a.redirectUri],
            response_types: ['code'],
          });
        }
        const o = this.config.oidc;
        const issuer = await Issuer.discover(o.issuer);
        return new issuer.Client({
          client_id: o.clientId,
          client_secret: o.clientSecret || undefined,
          redirect_uris: [o.redirectUri],
          response_types: ['code'],
          token_endpoint_auth_method: o.clientSecret ? 'client_secret_basic' : 'none',
        });
      })();
      p.catch(() => this.clients.delete(id));
      this.clients.set(id, p);
    }
    return p;
  }

  async authorizationUrl(id: SsoProviderId): Promise<string> {
    const client = await this.getClient(id);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    await this.cache.setJson(`sem:sso:${state}`, { provider: id, nonce, codeVerifier } satisfies SsoState, 600);
    return client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      redirect_uri: this.redirectUri(id),
      response_mode: 'query',
    });
  }

  async handleCallback(id: SsoProviderId, query: Record<string, string>): Promise<SsoIdentity> {
    const client = await this.getClient(id);
    if (query.error) throw new UnauthorizedException(query.error_description || query.error);
    const state = query.state;
    if (!state) throw new UnauthorizedException('Missing state');
    const saved = await this.cache.getJson<SsoState>(`sem:sso:${state}`);
    await this.cache.del(`sem:sso:${state}`);
    if (!saved || saved.provider !== id) throw new UnauthorizedException('SSO state is invalid or expired');

    const params = client.callbackParams(`?${new URLSearchParams(query).toString()}`);
    const tokenSet = await client.callback(this.redirectUri(id), params, {
      state,
      nonce: saved.nonce,
      code_verifier: saved.codeVerifier,
    });
    const claims = tokenSet.claims() as Record<string, unknown>;
    const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? '').toLowerCase();
    if (!email) throw new UnauthorizedException('Identity provider did not return an email address');
    const externalId = String(id === 'azure-ad' ? (claims.oid ?? claims.sub) : claims.sub);
    const displayName = String(claims.name ?? email);

    let role: RoleKey = 'EMPLOYEE';
    let roleFromGroups = false;
    if (id === 'azure-ad') {
      const map = this.config.azureAd.groupRoleMap;
      const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];
      for (const [groupId, mapped] of Object.entries(map)) {
        if (!ROLE_KEYS.includes(mapped) || !groups.includes(groupId)) continue;
        if (!roleFromGroups || ROLE_KEYS.indexOf(mapped) < ROLE_KEYS.indexOf(role)) role = mapped as RoleKey;
        roleFromGroups = true;
      }
      roleFromGroups = Object.keys(map).length > 0;
    }
    return {
      provider: id === 'azure-ad' ? 'AZURE_AD' : 'OIDC',
      externalId,
      email,
      displayName,
      role,
      roleFromGroups,
    };
  }
}
