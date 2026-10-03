-- CreateTable
CREATE TABLE "asset_likes" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "liker_tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_comments" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "author_tenant_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" VARCHAR(120) NOT NULL,
    "author_tenant_name" VARCHAR(120) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "hidden_at" TIMESTAMPTZ(6),
    "hidden_by_id" UUID,
    "hidden_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_likes_asset_id_idx" ON "asset_likes"("asset_id");

-- CreateIndex
CREATE INDEX "asset_likes_user_id_created_at_idx" ON "asset_likes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_likes_asset_id_user_id_key" ON "asset_likes"("asset_id", "user_id");

-- CreateIndex
CREATE INDEX "asset_comments_asset_id_created_at_idx" ON "asset_comments"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_comments_author_id_created_at_idx" ON "asset_comments"("author_id", "created_at");

-- AddForeignKey
ALTER TABLE "asset_likes" ADD CONSTRAINT "asset_likes_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public_catalog_entries"("asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_comments" ADD CONSTRAINT "asset_comments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public_catalog_entries"("asset_id") ON DELETE CASCADE ON UPDATE CASCADE;
