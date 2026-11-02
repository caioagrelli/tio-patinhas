-- Projetos, conversas fixadas/arquivadas e respostas salvas (artefatos) do Crab AI.
CREATE TABLE "AiProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📁',
    "instructions" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiProject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiProject_userId_idx" ON "AiProject"("userId");
ALTER TABLE "AiProject" ADD CONSTRAINT "AiProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiConversation" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiConversation" ADD COLUMN "projectId" TEXT;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AiProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD COLUMN "saved" BOOLEAN NOT NULL DEFAULT false;
