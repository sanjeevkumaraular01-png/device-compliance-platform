-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "previous_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "sessions_previous_token_hash_idx" ON "sessions"("previous_token_hash");
