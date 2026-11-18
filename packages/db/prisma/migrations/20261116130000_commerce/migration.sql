-- Commercial marketplace: priced listings, orders, entitlements, royalty ledger.
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');
CREATE TYPE "PaymentProvider" AS ENUM ('dev', 'stripe');

ALTER TABLE "public_catalog_entries"
  ADD COLUMN IF NOT EXISTS "price_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) NOT NULL DEFAULT 'USD';

CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "buyer_user_id" UUID NOT NULL,
  "seller_tenant_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending',
  "provider" "PaymentProvider" NOT NULL DEFAULT 'dev',
  "provider_ref" VARCHAR(200),
  "checkout_url" VARCHAR(1000),
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entitlements" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "order_id" UUID,
  "seller_tenant_id" UUID NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "royalty_ledgers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "platform_bps" INTEGER NOT NULL DEFAULT 1000,
  "seller_cents" INTEGER NOT NULL,
  "platform_cents" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "royalty_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");
CREATE INDEX "orders_tenant_id_buyer_user_id_idx" ON "orders"("tenant_id", "buyer_user_id");
CREATE INDEX "orders_asset_id_idx" ON "orders"("asset_id");

CREATE UNIQUE INDEX "entitlements_order_id_key" ON "entitlements"("order_id");
CREATE UNIQUE INDEX "entitlements_tenant_id_user_id_asset_id_key" ON "entitlements"("tenant_id", "user_id", "asset_id");
CREATE INDEX "entitlements_tenant_id_asset_id_idx" ON "entitlements"("tenant_id", "asset_id");

CREATE INDEX "royalty_ledgers_tenant_id_created_at_idx" ON "royalty_ledgers"("tenant_id", "created_at");
CREATE INDEX "royalty_ledgers_order_id_idx" ON "royalty_ledgers"("order_id");

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "royalty_ledgers" ADD CONSTRAINT "royalty_ledgers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "royalty_ledgers" ADD CONSTRAINT "royalty_ledgers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
