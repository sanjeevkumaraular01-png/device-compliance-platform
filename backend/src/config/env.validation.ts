import * as Joi from 'joi';

const jsonObject = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    if (!value) return value;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return helpers.error('any.invalid');
      }
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'JSON object');

const bool = (def: boolean) => Joi.boolean().truthy('true').falsy('false').default(def);

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(4000),
  APP_ROLE: Joi.string().valid('api', 'worker', 'all').default('all'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent').default('info'),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7),
  ENCRYPTION_KEY: Joi.string()
    .required()
    .custom((value: string, helpers) => {
      if (Buffer.from(value, 'base64').length !== 32) return helpers.error('any.invalid');
      return value;
    }, 'base64 32-byte key')
    .messages({ 'any.invalid': 'ENCRYPTION_KEY must be the base64 encoding of exactly 32 bytes' }),

  CORS_ORIGINS: Joi.string().allow('').default('http://localhost:3000'),
  WEB_URL: Joi.string().uri().default('http://localhost:3000'),
  API_PUBLIC_URL: Joi.string().uri().default('http://localhost:4000'),
  TRUST_PROXY: Joi.string().default('true'),

  RATE_LIMIT_TTL: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),

  SECURITY_MFA_REQUIRED_ROLES: Joi.string().allow('').default('SUPER_ADMIN,SECURITY_ADMIN'),
  SESSION_IDLE_TIMEOUT_MINUTES: Joi.number().integer().min(1).default(30),

  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  SMTP_FROM: Joi.string().allow('').optional(),

  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_FROM_NUMBER: Joi.string().allow('').optional(),
  TWILIO_WHATSAPP_FROM: Joi.string().allow('').optional(),

  LDAP_URL: Joi.string().allow('').optional(),
  LDAP_BIND_DN: Joi.string().allow('').optional(),
  LDAP_BIND_PASSWORD: Joi.string().allow('').optional(),
  LDAP_SEARCH_BASE: Joi.string().allow('').optional(),
  LDAP_SEARCH_FILTER: Joi.string().default('(sAMAccountName={{username}})'),
  LDAP_TLS_REJECT_UNAUTHORIZED: bool(true),
  LDAP_DEFAULT_ROLE: Joi.string()
    .valid('SUPER_ADMIN', 'SECURITY_ADMIN', 'COMPLIANCE_OFFICER', 'IT_ADMIN', 'DEPARTMENT_MANAGER', 'EMPLOYEE', 'AUDITOR')
    .default('EMPLOYEE'),
  LDAP_GROUP_ROLE_MAP: jsonObject.optional(),

  AZURE_AD_TENANT_ID: Joi.string().allow('').optional(),
  AZURE_AD_CLIENT_ID: Joi.string().allow('').optional(),
  AZURE_AD_CLIENT_SECRET: Joi.string().allow('').optional(),
  AZURE_AD_REDIRECT_URI: Joi.string().allow('').optional(),
  AZURE_AD_GROUP_ROLE_MAP: jsonObject.optional(),

  OIDC_ISSUER: Joi.string().allow('').optional(),
  OIDC_CLIENT_ID: Joi.string().allow('').optional(),
  OIDC_CLIENT_SECRET: Joi.string().allow('').optional(),
  OIDC_REDIRECT_URI: Joi.string().allow('').optional(),

  REPORTS_DIR: Joi.string().default('./data/reports'),
  CA_CERT_PATH: Joi.string().default('./data/pki/ca.crt'),
  CA_KEY_PATH: Joi.string().default('./data/pki/ca.key'),
  AGENT_DOWNLOAD_BASE_URL: Joi.string().default('http://localhost/downloads'),

  SEED_ADMIN_EMAIL: Joi.string().email({ tlds: false }).default('admin@secureendpoint.local'),
  SEED_ADMIN_PASSWORD: Joi.string().default('ChangeMe!Secure2026'),
  SEED_DEMO_DATA: bool(true),
  // Defaults to SEED_DEMO_DATA (resolved in AppConfigService), so no Joi default here.
  DEMO_ACTIVITY: Joi.boolean().truthy('true').falsy('false').allow(''),
  RUN_MIGRATIONS: bool(true),
  RUN_SEED: bool(true),
});
