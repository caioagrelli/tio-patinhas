-- Confirmação de e-mail e redefinição de senha por e-mail.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
-- Contas do Google já têm o e-mail verificado pelo Google.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "googleId" IS NOT NULL AND "email" IS NOT NULL;

CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");
CREATE INDEX "EmailToken_userId_kind_createdAt_idx" ON "EmailToken"("userId", "kind", "createdAt");
ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
