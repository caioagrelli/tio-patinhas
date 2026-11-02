-- Exclusão de conta (LGPD): os dados da pessoa saem; pagamentos e custos da IA ficam anônimos para a contabilidade.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_userId_fkey";
ALTER TABLE "Payment" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsage" DROP CONSTRAINT "AiUsage_userId_fkey";
ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
