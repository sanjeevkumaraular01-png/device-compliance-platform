-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('SUPER_ADMIN', 'SECURITY_ADMIN', 'COMPLIANCE_OFFICER', 'IT_ADMIN', 'DEPARTMENT_MANAGER', 'EMPLOYEE', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'LDAP', 'ACTIVE_DIRECTORY', 'AZURE_AD', 'OIDC');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('LAPTOP', 'DESKTOP', 'SERVER', 'VIRTUAL_MACHINE', 'WORKSTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "OsPlatform" AS ENUM ('WINDOWS', 'LINUX', 'MACOS');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'QUARANTINED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ComplianceState" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProtectionState" AS ENUM ('ENABLED', 'DISABLED', 'NOT_INSTALLED', 'OUTDATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SoftwareStatus" AS ENUM ('APPROVED', 'UNAUTHORIZED', 'BLACKLISTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('EXACT', 'CONTAINS', 'REGEX');

-- CreateEnum
CREATE TYPE "UsbDeviceClass" AS ENUM ('MASS_STORAGE', 'HID', 'AUDIO', 'VIDEO', 'PRINTER', 'NETWORK', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "UsbEventType" AS ENUM ('CONNECTED', 'DISCONNECTED', 'BLOCKED', 'ALLOWED', 'FILE_WRITE', 'FILE_READ');

-- CreateEnum
CREATE TYPE "UsbAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WhitelistScope" AS ENUM ('GLOBAL', 'DEPARTMENT', 'USER', 'DEVICE');

-- CreateEnum
CREATE TYPE "PatchCategory" AS ENUM ('OS', 'SECURITY', 'APPLICATION', 'DRIVER', 'FEATURE');

-- CreateEnum
CREATE TYPE "PatchSeverity" AS ENUM ('CRITICAL', 'IMPORTANT', 'MODERATE', 'LOW', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "PatchState" AS ENUM ('INSTALLED', 'MISSING', 'PENDING_INSTALL', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('COMPLIANCE', 'USB', 'SOFTWARE', 'SECURITY', 'PATCH', 'AUTH', 'DEVICE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('EMAIL', 'SMS', 'SLACK', 'TEAMS', 'WHATSAPP', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('USER_ACTION', 'DEVICE_CHANGE', 'POLICY_CHANGE', 'AUTH', 'USB', 'SOFTWARE', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'DEVICE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COMPLIANCE', 'DEVICE', 'SOFTWARE', 'SECURITY', 'AUDIT', 'USB', 'PATCH');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'XLSX', 'CSV');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('UNINSTALL_SOFTWARE', 'INSTALL_PATCHES', 'APPLY_POLICY', 'COLLECT_INVENTORY', 'LOCK_SCREEN', 'RESTART', 'ENABLE_ENCRYPTION', 'REFRESH_USB_RULES');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'SENT', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "manager_id" UUID,
    "policy_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "auth_provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
    "external_id" TEXT,
    "role_id" UUID NOT NULL,
    "department_id" UUID,
    "job_title" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "mfa_recovery_hashes" TEXT[],
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "mfa_used" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_restrictions" (
    "id" UUID NOT NULL,
    "cidr" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "device_name" TEXT NOT NULL,
    "hostname" TEXT,
    "serial_number" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "device_type" "DeviceType" NOT NULL DEFAULT 'LAPTOP',
    "platform" "OsPlatform" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "cpu" TEXT,
    "ram_mb" INTEGER,
    "storage_gb" INTEGER,
    "os_name" TEXT,
    "os_version" TEXT,
    "os_build" TEXT,
    "ip_address" TEXT,
    "mac_addresses" TEXT[],
    "assigned_user_id" UUID,
    "department_id" UUID,
    "policy_id" UUID,
    "purchase_date" DATE,
    "warranty_expires_at" DATE,
    "warranty_status" "WarrantyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "is_company_owned" BOOLEAN NOT NULL DEFAULT true,
    "compliance_state" "ComplianceState" NOT NULL DEFAULT 'UNKNOWN',
    "compliance_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'NONE',
    "last_evaluated_at" TIMESTAMP(3),
    "agent_version" TEXT,
    "agent_token_hash" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "enrolled_at" TIMESTAMP(3),
    "tags" TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_tokens" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "platform" "OsPlatform",
    "department_id" UUID,
    "policy_id" UUID,
    "max_uses" INTEGER NOT NULL DEFAULT 100,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "auto_approve" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_certificates" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "pem" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "device_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,
    "company_data_only_managed" BOOLEAN NOT NULL DEFAULT true,
    "usb_storage_blocked" BOOLEAN NOT NULL DEFAULT true,
    "allow_whitelisted_usb" BOOLEAN NOT NULL DEFAULT true,
    "usb_read_only" BOOLEAN NOT NULL DEFAULT false,
    "block_unauthorized_software" BOOLEAN NOT NULL DEFAULT true,
    "auto_uninstall_blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "require_antivirus" BOOLEAN NOT NULL DEFAULT true,
    "require_edr" BOOLEAN NOT NULL DEFAULT true,
    "require_firewall" BOOLEAN NOT NULL DEFAULT true,
    "require_disk_encryption" BOOLEAN NOT NULL DEFAULT true,
    "require_secure_boot" BOOLEAN NOT NULL DEFAULT false,
    "max_av_signature_age_days" INTEGER NOT NULL DEFAULT 3,
    "auto_update_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_patch_deployment" BOOLEAN NOT NULL DEFAULT true,
    "patch_deadline_days" INTEGER NOT NULL DEFAULT 14,
    "maintenance_window" TEXT,
    "screen_lock_enabled" BOOLEAN NOT NULL DEFAULT true,
    "screen_lock_timeout_sec" INTEGER NOT NULL DEFAULT 300,
    "require_password_on_wake" BOOLEAN NOT NULL DEFAULT true,
    "screen_saver_enforced" BOOLEAN NOT NULL DEFAULT true,
    "checkin_interval_sec" INTEGER NOT NULL DEFAULT 300,
    "inventory_interval_sec" INTEGER NOT NULL DEFAULT 3600,
    "extra_settings" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "severity" "RiskLevel" NOT NULL,
    "weight" INTEGER NOT NULL,
    "mark_non_compliant" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "platforms" "OsPlatform"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_results" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "policy_id" UUID,
    "policy_version" INTEGER,
    "score" INTEGER NOT NULL,
    "state" "ComplianceState" NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "critical_count" INTEGER NOT NULL DEFAULT 0,
    "high_count" INTEGER NOT NULL DEFAULT 0,
    "medium_count" INTEGER NOT NULL DEFAULT 0,
    "low_count" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_whitelist" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT,
    "match_type" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "min_version" TEXT,
    "category" TEXT,
    "platform" "OsPlatform",
    "license_type" TEXT,
    "license_count" INTEGER,
    "license_key_enc" TEXT,
    "license_expires_at" TIMESTAMP(3),
    "cost_per_seat" DECIMAL(12,2),
    "vendor_url" TEXT,
    "notes" TEXT,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "software_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_blacklist" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT,
    "match_type" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "platform" "OsPlatform",
    "reason" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL DEFAULT 'HIGH',
    "auto_uninstall" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "software_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_inventory" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT,
    "install_date" TIMESTAMP(3),
    "install_location" TEXT,
    "size_mb" INTEGER,
    "source" TEXT,
    "status" "SoftwareStatus" NOT NULL DEFAULT 'UNKNOWN',
    "matched_rule_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "software_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usb_devices" (
    "id" UUID NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT,
    "product_name" TEXT,
    "device_class" "UsbDeviceClass" NOT NULL DEFAULT 'OTHER',
    "is_whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "whitelist_scope" "WhitelistScope" NOT NULL DEFAULT 'GLOBAL',
    "scope_ref_id" UUID,
    "read_only" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usb_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usb_events" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "usb_device_id" UUID,
    "event_type" "UsbEventType" NOT NULL,
    "device_class" "UsbDeviceClass" NOT NULL DEFAULT 'OTHER',
    "vendor_id" TEXT,
    "product_id" TEXT,
    "serial_number" TEXT,
    "label" TEXT,
    "user_name" TEXT,
    "file_path" TEXT,
    "bytes" BIGINT,
    "policy_reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usb_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usb_access_requests" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "usb_device_id" UUID,
    "vendor_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL DEFAULT '',
    "requester_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "duration_hours" INTEGER NOT NULL DEFAULT 4,
    "read_only" BOOLEAN NOT NULL DEFAULT true,
    "status" "UsbAccessStatus" NOT NULL DEFAULT 'PENDING',
    "approver_id" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usb_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_status" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "antivirus_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "antivirus_product" TEXT,
    "antivirus_signature_at" TIMESTAMP(3),
    "edr_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "edr_product" TEXT,
    "firewall_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "disk_encryption_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "encryption_method" TEXT,
    "bitlocker_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "secure_boot_state" "ProtectionState" NOT NULL DEFAULT 'UNKNOWN',
    "tpm_present" BOOLEAN,
    "screen_lock_enabled" BOOLEAN,
    "screen_lock_timeout_sec" INTEGER,
    "password_on_wake" BOOLEAN,
    "screen_saver_enabled" BOOLEAN,
    "auto_update_enabled" BOOLEAN,
    "usb_storage_enabled" BOOLEAN,
    "pending_reboot_required" BOOLEAN,
    "last_boot_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "collected_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patch_status" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "patch_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "PatchCategory" NOT NULL DEFAULT 'OS',
    "severity" "PatchSeverity" NOT NULL DEFAULT 'UNSPECIFIED',
    "state" "PatchState" NOT NULL,
    "product" TEXT,
    "cve_ids" TEXT[],
    "cvss_score" DOUBLE PRECISION,
    "released_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patch_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "type" "CommandType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "device_id" UUID,
    "category" "AlertCategory" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rule_key" TEXT,
    "dedupe_key" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_channels" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AlertChannelType" NOT NULL,
    "config_enc" TEXT NOT NULL,
    "min_severity" "AlertSeverity" NOT NULL DEFAULT 'HIGH',
    "categories" "AlertCategory"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "device_id" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "file_path" TEXT,
    "file_size" INTEGER,
    "row_count" INTEGER,
    "error" TEXT,
    "requested_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "cron" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_external_id_key" ON "users"("auth_provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_history_user_id_occurred_at_idx" ON "login_history"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "login_history_occurred_at_idx" ON "login_history"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "ip_restrictions_cidr_key" ON "ip_restrictions"("cidr");

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_number_key" ON "devices"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "devices_asset_id_key" ON "devices"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_agent_token_hash_key" ON "devices"("agent_token_hash");

-- CreateIndex
CREATE INDEX "devices_platform_idx" ON "devices"("platform");

-- CreateIndex
CREATE INDEX "devices_compliance_state_idx" ON "devices"("compliance_state");

-- CreateIndex
CREATE INDEX "devices_risk_level_idx" ON "devices"("risk_level");

-- CreateIndex
CREATE INDEX "devices_department_id_idx" ON "devices"("department_id");

-- CreateIndex
CREATE INDEX "devices_assigned_user_id_idx" ON "devices"("assigned_user_id");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE INDEX "device_assignments_device_id_idx" ON "device_assignments"("device_id");

-- CreateIndex
CREATE INDEX "device_assignments_user_id_idx" ON "device_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_tokens_token_hash_key" ON "enrollment_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_certificates_serial_number_key" ON "device_certificates"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "device_certificates_fingerprint_key" ON "device_certificates"("fingerprint");

-- CreateIndex
CREATE INDEX "device_certificates_device_id_idx" ON "device_certificates"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_policies_name_key" ON "device_policies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_rules_key_key" ON "compliance_rules"("key");

-- CreateIndex
CREATE INDEX "compliance_results_device_id_evaluated_at_idx" ON "compliance_results"("device_id", "evaluated_at");

-- CreateIndex
CREATE INDEX "compliance_results_evaluated_at_idx" ON "compliance_results"("evaluated_at");

-- CreateIndex
CREATE UNIQUE INDEX "software_whitelist_name_platform_key" ON "software_whitelist"("name", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "software_blacklist_name_platform_key" ON "software_blacklist"("name", "platform");

-- CreateIndex
CREATE INDEX "software_inventory_name_idx" ON "software_inventory"("name");

-- CreateIndex
CREATE INDEX "software_inventory_status_idx" ON "software_inventory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "software_inventory_device_id_name_version_key" ON "software_inventory"("device_id", "name", "version");

-- CreateIndex
CREATE INDEX "usb_devices_is_whitelisted_idx" ON "usb_devices"("is_whitelisted");

-- CreateIndex
CREATE UNIQUE INDEX "usb_devices_vendor_id_product_id_serial_number_key" ON "usb_devices"("vendor_id", "product_id", "serial_number");

-- CreateIndex
CREATE INDEX "usb_events_device_id_occurred_at_idx" ON "usb_events"("device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usb_events_event_type_occurred_at_idx" ON "usb_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "usb_access_requests_status_idx" ON "usb_access_requests"("status");

-- CreateIndex
CREATE INDEX "usb_access_requests_device_id_idx" ON "usb_access_requests"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "security_status_device_id_key" ON "security_status"("device_id");

-- CreateIndex
CREATE INDEX "patch_status_state_severity_idx" ON "patch_status"("state", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "patch_status_device_id_patch_id_key" ON "patch_status"("device_id", "patch_id");

-- CreateIndex
CREATE INDEX "device_commands_device_id_status_idx" ON "device_commands"("device_id", "status");

-- CreateIndex
CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "alerts_device_id_idx" ON "alerts"("device_id");

-- CreateIndex
CREATE INDEX "alerts_dedupe_key_status_idx" ON "alerts"("dedupe_key", "status");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_channels_name_key" ON "alert_channels"("name");

-- CreateIndex
CREATE INDEX "alert_deliveries_alert_id_idx" ON "alert_deliveries"("alert_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_category_occurred_at_idx" ON "audit_logs"("category", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_device_id_idx" ON "audit_logs"("device_id");

-- CreateIndex
CREATE INDEX "reports_requested_by_id_idx" ON "reports"("requested_by_id");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "device_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "device_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_certificates" ADD CONSTRAINT "device_certificates_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_inventory" ADD CONSTRAINT "software_inventory_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_events" ADD CONSTRAINT "usb_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_events" ADD CONSTRAINT "usb_events_usb_device_id_fkey" FOREIGN KEY ("usb_device_id") REFERENCES "usb_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_access_requests" ADD CONSTRAINT "usb_access_requests_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_access_requests" ADD CONSTRAINT "usb_access_requests_usb_device_id_fkey" FOREIGN KEY ("usb_device_id") REFERENCES "usb_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_access_requests" ADD CONSTRAINT "usb_access_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_access_requests" ADD CONSTRAINT "usb_access_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_status" ADD CONSTRAINT "security_status_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patch_status" ADD CONSTRAINT "patch_status_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "alert_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
