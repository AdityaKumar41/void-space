-- On-chain skill credential anchoring fields + worker queue.
CREATE TYPE "CredentialMintStatus" AS ENUM ('pending', 'minted', 'failed', 'skipped');

ALTER TABLE "skill_credentials"
  ADD COLUMN IF NOT EXISTS "mint_status" "CredentialMintStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "token_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "contract_address" VARCHAR(42),
  ADD COLUMN IF NOT EXISTS "tx_hash" VARCHAR(66),
  ADD COLUMN IF NOT EXISTS "mint_error" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "minted_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "skill_credentials_tenant_id_mint_status_idx"
  ON "skill_credentials"("tenant_id", "mint_status");

ALTER TYPE "JobQueue" ADD VALUE IF NOT EXISTS 'skill_credential';
