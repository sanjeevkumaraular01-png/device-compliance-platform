-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'BLOCKED', 'UNCATEGORIZED');

-- CreateEnum
CREATE TYPE "AppRuleKind" AS ENUM ('APP', 'WEBSITE');

-- CreateEnum
CREATE TYPE "WorkLocation" AS ENUM ('OFFICE', 'REMOTE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "ClockEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END', 'LOCK', 'UNLOCK', 'LOGON', 'LOGOFF', 'SLEEP', 'WAKE');

-- CreateEnum
CREATE TYPE "ClockSource" AS ENUM ('AGENT', 'WEB', 'MANUAL_CORRECTION');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'SALES_CRM', 'SUPPORT', 'DEVELOPMENT', 'MARKETING', 'HR', 'HARDWARE', 'NETWORK', 'FINANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('TIMER', 'AGENT_AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "AiInsightType" AS ENUM ('EMPLOYEE_DAILY', 'MANAGEMENT_DAILY');

-- CreateEnum
CREATE TYPE "AiInsightStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "AlertCategory" ADD VALUE 'WORKFORCE';

-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'HR_MANAGER';

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "subject_user_id" UUID;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "workforce_policy_id" UUID;

-- CreateTable
CREATE TABLE "workforce_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "work_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "work_start" TEXT NOT NULL DEFAULT '09:30',
    "work_end" TEXT NOT NULL DEFAULT '18:30',
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "min_daily_minutes" INTEGER NOT NULL DEFAULT 480,
    "half_day_minutes" INTEGER NOT NULL DEFAULT 240,
    "overtime_after_minutes" INTEGER NOT NULL DEFAULT 540,
    "max_break_minutes" INTEGER NOT NULL DEFAULT 60,
    "track_outside_work_hours" BOOLEAN NOT NULL DEFAULT false,
    "idle_threshold_sec" INTEGER NOT NULL DEFAULT 300,
    "track_apps" BOOLEAN NOT NULL DEFAULT true,
    "track_websites" BOOLEAN NOT NULL DEFAULT true,
    "capture_window_titles" BOOLEAN NOT NULL DEFAULT false,
    "screenshots_enabled" BOOLEAN NOT NULL DEFAULT false,
    "screenshot_interval_min" INTEGER NOT NULL DEFAULT 15,
    "screenshot_blur" BOOLEAN NOT NULL DEFAULT true,
    "screenshot_retention_days" INTEGER NOT NULL DEFAULT 30,
    "office_networks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "require_task_selection" BOOLEAN NOT NULL DEFAULT false,
    "require_daily_report" BOOLEAN NOT NULL DEFAULT true,
    "daily_report_due_time" TEXT NOT NULL DEFAULT '19:30',
    "alert_late_login" BOOLEAN NOT NULL DEFAULT true,
    "alert_no_activity_minutes" INTEGER NOT NULL DEFAULT 30,
    "alert_idle_percent" INTEGER NOT NULL DEFAULT 40,
    "alert_overtime_minutes" INTEGER NOT NULL DEFAULT 120,
    "alert_unproductive_percent" INTEGER NOT NULL DEFAULT 30,
    "employee_can_see_own_data" BOOLEAN NOT NULL DEFAULT true,
    "show_tracking_notice" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workforce_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_rules" (
    "id" UUID NOT NULL,
    "kind" "AppRuleKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "match_type" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "label" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "department_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "location" "WorkLocation" NOT NULL DEFAULT 'UNKNOWN',
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "first_activity_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "active_sec" INTEGER NOT NULL DEFAULT 0,
    "idle_sec" INTEGER NOT NULL DEFAULT 0,
    "productive_sec" INTEGER NOT NULL DEFAULT 0,
    "neutral_sec" INTEGER NOT NULL DEFAULT 0,
    "unproductive_sec" INTEGER NOT NULL DEFAULT 0,
    "break_sec" INTEGER NOT NULL DEFAULT 0,
    "meeting_sec" INTEGER NOT NULL DEFAULT 0,
    "focus_sec" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_leave_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "missing_minutes" INTEGER NOT NULL DEFAULT 0,
    "current_app" TEXT,
    "current_task_id" UUID,
    "device_id" UUID,
    "is_manually_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_note" TEXT,
    "adjusted_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clock_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "type" "ClockEventType" NOT NULL,
    "source" "ClockSource" NOT NULL,
    "location" "WorkLocation" NOT NULL DEFAULT 'UNKNOWN',
    "ip_address" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_segments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "app" TEXT,
    "app_label" TEXT,
    "domain" TEXT,
    "window_title" TEXT,
    "category" "ActivityCategory" NOT NULL DEFAULT 'UNCATEGORIZED',
    "input_events" INTEGER NOT NULL DEFAULT 0,
    "task_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_hourly" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "active_sec" INTEGER NOT NULL DEFAULT 0,
    "idle_sec" INTEGER NOT NULL DEFAULT 0,
    "productive_sec" INTEGER NOT NULL DEFAULT 0,
    "neutral_sec" INTEGER NOT NULL DEFAULT 0,
    "unproductive_sec" INTEGER NOT NULL DEFAULT 0,
    "input_events" INTEGER NOT NULL DEFAULT 0,
    "top_app" TEXT,

    CONSTRAINT "activity_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screenshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "file_path" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "blurred" BOOLEAN NOT NULL,
    "active_app" TEXT,
    "task_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "client_name" TEXT,
    "department_id" UUID,
    "owner_id" UUID,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "budget_hours" INTEGER,
    "start_date" DATE,
    "due_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" "TaskSource" NOT NULL DEFAULT 'MANUAL',
    "external_ref" TEXT,
    "assignee_id" UUID,
    "created_by_id" UUID,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "estimated_minutes" INTEGER,
    "tracked_sec" INTEGER NOT NULL DEFAULT 0,
    "due_date" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "delay_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "source" "TimeEntrySource" NOT NULL DEFAULT 'TIMER',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_work_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "auto_draft" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMP(3),
    "reviewer_id" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_work_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_items" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "task_id" UUID,
    "project_name" TEXT,
    "task_title" TEXT NOT NULL,
    "work_completed" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "pending_work" TEXT,
    "blocker" TEXT,
    "next_action" TEXT,
    "evidence_url" TEXT,
    "minutes_spent" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "type" "AiInsightType" NOT NULL,
    "date" DATE NOT NULL,
    "user_id" UUID,
    "department_id" UUID,
    "status" "AiInsightStatus" NOT NULL DEFAULT 'PENDING',
    "content" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "batch_id" TEXT,
    "custom_id" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workforce_policies_name_key" ON "workforce_policies"("name");

-- CreateIndex
CREATE INDEX "app_rules_department_id_idx" ON "app_rules"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_rules_kind_pattern_department_id_key" ON "app_rules"("kind", "pattern", "department_id");

-- CreateIndex
CREATE INDEX "work_sessions_date_idx" ON "work_sessions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_user_id_date_key" ON "work_sessions"("user_id", "date");

-- CreateIndex
CREATE INDEX "clock_events_user_id_occurred_at_idx" ON "clock_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_segments_user_id_started_at_idx" ON "activity_segments"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_segments_started_at_idx" ON "activity_segments"("started_at");

-- CreateIndex
CREATE INDEX "activity_hourly_hour_idx" ON "activity_hourly"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "activity_hourly_user_id_hour_key" ON "activity_hourly"("user_id", "hour");

-- CreateIndex
CREATE INDEX "screenshots_user_id_captured_at_idx" ON "screenshots"("user_id", "captured_at");

-- CreateIndex
CREATE INDEX "screenshots_expires_at_idx" ON "screenshots"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "work_tasks_assignee_id_status_idx" ON "work_tasks"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "work_tasks_project_id_idx" ON "work_tasks"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_tasks_source_external_ref_key" ON "work_tasks"("source", "external_ref");

-- CreateIndex
CREATE INDEX "time_entries_user_id_started_at_idx" ON "time_entries"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "time_entries_task_id_idx" ON "time_entries"("task_id");

-- CreateIndex
CREATE INDEX "daily_work_reports_date_status_idx" ON "daily_work_reports"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_work_reports_user_id_date_key" ON "daily_work_reports"("user_id", "date");

-- CreateIndex
CREATE INDEX "daily_report_items_report_id_idx" ON "daily_report_items"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_custom_id_key" ON "ai_insights"("custom_id");

-- CreateIndex
CREATE INDEX "ai_insights_date_type_idx" ON "ai_insights"("date", "type");

-- CreateIndex
CREATE INDEX "ai_insights_user_id_date_idx" ON "ai_insights"("user_id", "date");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_workforce_policy_id_fkey" FOREIGN KEY ("workforce_policy_id") REFERENCES "workforce_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_rules" ADD CONSTRAINT "app_rules_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_hourly" ADD CONSTRAINT "activity_hourly_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_work_reports" ADD CONSTRAINT "daily_work_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_work_reports" ADD CONSTRAINT "daily_work_reports_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_work_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "work_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
