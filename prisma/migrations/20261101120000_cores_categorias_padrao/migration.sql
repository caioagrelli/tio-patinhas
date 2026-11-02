-- Cores distintas para as categorias padrão (como no app Django), só onde ainda está a cor padrão antiga.
UPDATE "Category" SET "color" = CASE "name"
  WHEN 'Alimentação' THEN '#f64301' WHEN 'Transporte' THEN '#4fd4ff' WHEN 'Lazer' THEN '#ff4fd4' WHEN 'Moradia' THEN '#ffb84f'
  WHEN 'Saúde' THEN '#4fff88' WHEN 'Educação' THEN '#a04fff' WHEN 'Outros' THEN '#a0a0a0' ELSE "color" END
WHERE "isDefault" AND "color" = '#d4ff3f';
