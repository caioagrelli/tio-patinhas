-- Login exclusivo com Google: contas antigas mantêm o hash, novas não têm senha.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
