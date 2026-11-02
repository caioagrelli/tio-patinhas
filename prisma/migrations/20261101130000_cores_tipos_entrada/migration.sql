-- Cores distintas para os tipos de entrada padrão, só onde ainda está a cor padrão antiga.
UPDATE "IncomeType" SET "color" = CASE "name"
  WHEN 'Salário' THEN '#4fff88' WHEN 'Freelance' THEN '#4fd4ff' WHEN 'Investimentos' THEN '#ffb84f' WHEN 'Presente' THEN '#ff4fd4' WHEN 'Outros' THEN '#a0a0a0' ELSE "color" END
WHERE "color" = '#d4ff3f';
