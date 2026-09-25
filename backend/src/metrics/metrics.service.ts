import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Prometheus registry + all `sem_*` metrics (names are a contract with Grafana dashboards). */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'sem_http_requests_total',
    help: 'HTTP requests processed',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram({
    name: 'sem_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly devicesTotal = new Gauge({
    name: 'sem_devices_total',
    help: 'Managed devices (excluding retired) by platform',
    labelNames: ['platform'] as const,
    registers: [this.registry],
  });
  readonly devicesCompliance = new Gauge({
    name: 'sem_devices_compliance',
    help: 'Devices by compliance state',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });
  readonly devicesRisk = new Gauge({
    name: 'sem_devices_risk',
    help: 'Devices by risk level',
    labelNames: ['risk_level'] as const,
    registers: [this.registry],
  });
  readonly devicesOnline = new Gauge({
    name: 'sem_devices_online',
    help: 'Devices seen within the last 15 minutes',
    registers: [this.registry],
  });
  readonly agentCheckins = new Counter({
    name: 'sem_agent_checkins_total',
    help: 'Agent heartbeats received',
    registers: [this.registry],
  });
  readonly agentReports = new Counter({
    name: 'sem_agent_reports_total',
    help: 'Agent full-state reports received',
    registers: [this.registry],
  });
  readonly usbBlocked = new Counter({
    name: 'sem_usb_blocked_total',
    help: 'Blocked USB events received',
    registers: [this.registry],
  });
  readonly softwareViolations = new Gauge({
    name: 'sem_software_violations',
    help: 'Installed software items that are UNAUTHORIZED or BLACKLISTED',
    registers: [this.registry],
  });
  readonly alertsOpen = new Gauge({
    name: 'sem_alerts_open',
    help: 'Open alerts by severity',
    labelNames: ['severity'] as const,
    registers: [this.registry],
  });
  readonly alertsSent = new Counter({
    name: 'sem_alerts_sent_total',
    help: 'Alert notifications delivered by channel type and status',
    labelNames: ['channel', 'status'] as const,
    registers: [this.registry],
  });
  readonly queueJobs = new Gauge({
    name: 'sem_queue_jobs',
    help: 'BullMQ jobs by queue and state',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });
  readonly complianceEvaluations = new Counter({
    name: 'sem_compliance_evaluations_total',
    help: 'Compliance evaluations performed',
    registers: [this.registry],
  });
  readonly loginAttempts = new Counter({
    name: 'sem_login_attempts_total',
    help: 'Console login attempts by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ app: 'secureendpoint-backend' });
    collectDefaultMetrics({ register: this.registry });
  }
}
