-- Projetos e arquivamento saíram do Crab AI; fixar conversas e salvar respostas continuam.
ALTER TABLE "AiConversation" DROP CONSTRAINT "AiConversation_projectId_fkey";
ALTER TABLE "AiConversation" DROP COLUMN "projectId";
ALTER TABLE "AiConversation" DROP COLUMN "archived";
DROP TABLE "AiProject";
