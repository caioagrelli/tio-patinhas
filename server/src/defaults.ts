import { Prisma } from '@prisma/client';
export async function createDefaults(tx: Prisma.TransactionClient, userId: string) {
  await tx.category.createMany({
    data: [
      ['Alimentação', '🍽️', '#f64301'],
      ['Transporte', '🚌', '#4fd4ff'],
      ['Lazer', '🎮', '#ff4fd4'],
      ['Moradia', '🏠', '#ffb84f'],
      ['Saúde', '💊', '#4fff88'],
      ['Educação', '📚', '#a04fff'],
      ['Outros', '💰', '#a0a0a0'],
    ].map(([name, icon, color]) => ({ userId, name, icon, color, isDefault: true })),
  });
  await tx.paymentMethod.createMany({
    data: [
      ['Dinheiro', 'dinheiro', '💵'],
      ['Pix', 'pix', '⚡'],
      ['Cartão de débito', 'debito', '💳'],
      ['Cartão de crédito', 'credito', '💳'],
      ['Transferência', 'transferencia', '🏦'],
      ['Boleto', 'boleto', '🧾'],
    ].map(([name, kind, icon]) => ({ userId, name, kind, icon })),
  });
  await tx.incomeType.createMany({
    data: [
      ['Salário', '💼', '#f64301'],
      ['Freelance', '🧑‍💻', '#4fd4ff'],
      ['Investimentos', '📈', '#4fff88'],
      ['Presente', '🎁', '#ff4fd4'],
      ['Outros', '💵', '#a0a0a0'],
    ].map(([name, icon, color]) => ({ userId, name, icon, color })),
  });
}
