import { z } from 'zod';
export const money = z.number().int().min(1).max(999_999_999_999);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(s => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '1900-01-01' && s <= '2200-12-31';
  }, 'Data inválida');
const name = z.string().trim().min(1).max(80);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .default('#f64301');
const icon = z.string().max(20).default('💰');
const reference = z.string().min(1).max(100).nullable().optional();
/**
 * Letters, digits and _ . + - only. No "@": the login field also accepts e-mails, so a username shaped like
 * someone else's e-mail could take over that person's e-mail login.
 */
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O usuário precisa ter pelo menos 3 caracteres.')
  .max(60, 'O usuário pode ter no máximo 60 caracteres.')
  .regex(/^[\p{L}\p{N}_.+-]+$/u, 'Use só letras, números e . _ - + (sem espaços nem @).');
export const credentials = z.object({ username, password: z.string().min(10).max(128) }).strict();
export const registration = credentials.extend({
  name: name.optional(),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),
});
export const loginInput = z
  .object({ username: z.string().trim().min(1).max(150), password: z.string().min(1).max(128) })
  .strict();
export const categoryInput = z.object({ name, color, icon }).strict();
export const paymentInput = z
  .object({ name, icon, kind: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'transferencia', 'boleto', 'outro']) })
  .strict();
export const incomeTypeInput = categoryInput;
export const cardInput = z
  .object({
    name,
    color,
    limit: money.nullable().optional(),
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
  })
  .strict();
export const boxInput = z.object({ name, color, icon, goal: money.nullable().optional() }).strict();
export const movementInput = z.object({ type: z.enum(['deposit', 'withdraw']), value: money }).strict();
export const transactionInput = z
  .object({
    type: z.enum(['income', 'expense']),
    kind: z.enum(['avista', 'fixo', 'parcelado']).default('avista'),
    value: money,
    description: z.string().trim().max(255).default(''),
    date,
    categoryId: reference,
    paymentMethodId: reference,
    cardId: reference,
    incomeTypeId: reference,
    installments: z.number().int().min(2).max(360).optional(),
    endDate: date.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'parcelado' && (v.type !== 'expense' || !v.installments || v.value < v.installments))
      ctx.addIssue({
        code: 'custom',
        message: 'Parcelamento exige uma saída, 2 a 360 parcelas e ao menos um centavo por parcela.',
      });
    if (v.endDate && v.endDate < v.date) ctx.addIssue({ code: 'custom', message: 'Fim anterior ao início.' });
  });
export const recurrenceInput = z
  .object({
    type: z.enum(['income', 'expense']),
    value: money,
    description: z.string().trim().max(255),
    categoryId: reference,
    paymentMethodId: reference,
    cardId: reference,
    incomeTypeId: reference,
    dayOfMonth: z.number().int().min(1).max(31),
    startDate: date,
    endDate: date.nullable(),
    active: z.boolean(),
  })
  .strict()
  .refine(v => !v.endDate || v.endDate >= v.startDate, 'Fim anterior ao início');
export const filterInput = z
  .object({
    from: date.optional(),
    to: date.optional(),
    categoryId: z.string().optional(),
    incomeTypeId: z.string().optional(),
    kind: z.enum(['avista', 'fixo', 'parcelado']).optional(),
    type: z.enum(['income', 'expense']).optional(),
  })
  .strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, 'Período inválido');
export const planInput = z
  .object({
    description: z.string().trim().max(255),
    categoryId: reference,
    paymentMethodId: reference,
    cardId: reference,
  })
  .strict();
export type TransactionInput = z.infer<typeof transactionInput>;
