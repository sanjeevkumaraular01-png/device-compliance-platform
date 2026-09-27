-- CreateEnum
CREATE TYPE "WorkProfileKey" AS ENUM ('SALES', 'HR', 'FINANCE', 'DEVELOPER', 'MANAGEMENT', 'SUPPORT', 'CUSTOM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employee_code" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "manager_id" UUID,
ADD COLUMN     "work_profile_id" UUID;

-- CreateTable
CREATE TABLE "work_profiles" (
    "id" UUID NOT NULL,
    "key" "WorkProfileKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "policy_id" UUID,
    "required_software" TEXT[],
    "prohibited_software" TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_profiles_name_key" ON "work_profiles"("name");

-- CreateIndex
CREATE INDEX "work_profiles_policy_id_idx" ON "work_profiles"("policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE INDEX "users_work_profile_id_idx" ON "users"("work_profile_id");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_work_profile_id_fkey" FOREIGN KEY ("work_profile_id") REFERENCES "work_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_profiles" ADD CONSTRAINT "work_profiles_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "device_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
