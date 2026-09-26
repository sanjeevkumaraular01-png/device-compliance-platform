import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { APP_ROLE, RUN_API } from './config/role';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { AppValidationPipe } from './common/validation.pipe';
import { MetricsService } from './metrics/metrics.service';

// BigInt (e.g. usb_events.bytes) -> JSON number when safe, else string.
(BigInt.prototype as unknown as { toJSON: () => number | string }).toJSON = function (this: bigint) {
  const n = Number(this);
  return Number.isSafeInteger(n) ? n : this.toString();
};

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  const config = app.get(AppConfigService);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // Body parsers first: body-parser stream callbacks would otherwise drop the async context.
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  // Request id + async (audit) context
  app.use(requestContextMiddleware);

  // HTTP metrics
  const metrics = app.get(MetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      metrics.httpRequests.inc(labels);
      end(labels);
    });
    next();
  });

  // Worker processes expose only health + metrics over HTTP.
  if (!RUN_API) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/metrics' || req.path.startsWith('/api/v1/health')) return next();
      res.status(404).json({
        statusCode: 404,
        error: 'Not Found',
        message: 'This process runs with APP_ROLE=worker (health and metrics only)',
        path: req.path,
        timestamp: new Date().toISOString(),
        requestId: (req as Request & { id?: string }).id ?? null,
      });
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const origins = config.corsOrigins;
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Device-Id'],
    exposedHeaders: ['X-Request-Id', 'X-MFA-Enrollment-Required', 'Content-Disposition'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'metrics', method: RequestMethod.GET }] });
  app.useGlobalPipes(new AppValidationPipe());
  app.enableShutdownHooks();

  if (RUN_API && config.swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle('SecureEndpoint Manager API')
      .setDescription('Device & software compliance platform REST API and agent protocol (see docs/API.md).')
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Agent token (sem_agt_...)' }, 'agent')
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      customSiteTitle: 'SecureEndpoint Manager API',
      swaggerOptions: { persistAuthorization: true },
    });
  }
  return app;
}

/** Loud, non-fatal warnings for insecure production configuration. */
function productionSecurityWarnings(config: AppConfigService, logger: Logger) {
  if (!config.isProduction) return;
  const warn = (msg: string) => logger.warn(`SECURITY: ${msg}`, 'Bootstrap');
  if (config.seedAdminPassword === 'ChangeMe!Secure2026') {
    warn('SEED_ADMIN_PASSWORD is still the built-in default — change it and rotate the admin password now.');
  }
  if (config.seedDemoData) {
    warn('SEED_DEMO_DATA is enabled in production — demo users and fake devices are present. Set SEED_DEMO_DATA=false.');
  }
  if (config.swaggerEnabled) {
    warn('Swagger UI (/api/docs) is enabled in production. Disable it unless intentionally exposed.');
  }
  if (!config.corsOrigins.length) {
    warn('CORS_ORIGINS is empty — browser clients on other origins will be blocked.');
  }
}

async function bootstrap() {
  const app = await createApp();
  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  productionSecurityWarnings(config, logger);
  await app.listen(config.port, '0.0.0.0');
  logger.log(`SecureEndpoint backend (role=${APP_ROLE}) listening on :${config.port}`, 'Bootstrap');
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error('Fatal startup error', e);
    process.exit(1);
  });
}
