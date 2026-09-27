-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "battery_percent" INTEGER,
ADD COLUMN     "battery_status" TEXT,
ADD COLUMN     "bios_version" TEXT,
ADD COLUMN     "dns_servers" TEXT[],
ADD COLUMN     "gateway" TEXT,
ADD COLUMN     "gpu" TEXT,
ADD COLUMN     "network_adapters" JSONB,
ADD COLUMN     "os_arch" TEXT,
ADD COLUMN     "os_edition" TEXT;

-- CreateTable
CREATE TABLE "device_services" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL,
    "start_type" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_services_device_id_idx" ON "device_services"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_services_device_id_name_key" ON "device_services"("device_id", "name");

-- AddForeignKey
ALTER TABLE "device_services" ADD CONSTRAINT "device_services_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
