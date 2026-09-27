-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "group_id" UUID;

-- CreateTable
CREATE TABLE "device_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_groups_name_key" ON "device_groups"("name");

-- CreateIndex
CREATE INDEX "devices_group_id_idx" ON "devices"("group_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "device_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
