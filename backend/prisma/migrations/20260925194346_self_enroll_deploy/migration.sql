-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'IMAP';

-- AlterTable
ALTER TABLE "enrollment_tokens" ADD COLUMN     "assign_to_user_id" UUID;

-- CreateIndex
CREATE INDEX "enrollment_tokens_assign_to_user_id_idx" ON "enrollment_tokens"("assign_to_user_id");

-- AddForeignKey
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_assign_to_user_id_fkey" FOREIGN KEY ("assign_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
