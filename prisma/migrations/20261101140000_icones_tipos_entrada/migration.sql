-- Ícones e cores dos tipos de entrada padrão como no app Django, só onde ainda estão os valores padrão.
UPDATE "IncomeType" SET "icon" = CASE "name" WHEN 'Salário' THEN '💼' WHEN 'Freelance' THEN '🧑‍💻' WHEN 'Investimentos' THEN '📈' WHEN 'Presente' THEN '🎁' ELSE "icon" END
WHERE "icon" = '💵' AND "name" IN ('Salário', 'Freelance', 'Investimentos', 'Presente');
UPDATE "IncomeType" SET "color" = '#f64301' WHERE "name" = 'Salário' AND "color" = '#4fff88';
UPDATE "IncomeType" SET "color" = '#4fff88' WHERE "name" = 'Investimentos' AND "color" = '#ffb84f';
