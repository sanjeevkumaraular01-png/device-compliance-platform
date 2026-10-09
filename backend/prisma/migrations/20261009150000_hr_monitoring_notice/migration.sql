-- CreateTable
CREATE TABLE "monitoring_notices" (
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_notices_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "policy_acknowledgements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notice_version" INTEGER NOT NULL,
    "signed_name" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_acknowledgements_notice_version_idx" ON "policy_acknowledgements"("notice_version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_acknowledgements_user_id_notice_version_key" ON "policy_acknowledgements"("user_id", "notice_version");

-- AddForeignKey
ALTER TABLE "monitoring_notices" ADD CONSTRAINT "monitoring_notices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_notice_version_fkey" FOREIGN KEY ("notice_version") REFERENCES "monitoring_notices"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

