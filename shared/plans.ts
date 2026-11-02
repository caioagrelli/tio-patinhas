// Plan prices in cents, shared by the server (charges) and the plans page (display).
export type PlanId = 'mensal' | 'anual' | 'vitalicio';
export const MONTHLY = 2690,
  ANNUAL_INSTALLMENT = 1690,
  ANNUAL = ANNUAL_INSTALLMENT * 12,
  LIFETIME = 26990;
export const planPrice: Record<PlanId, number> = { mensal: MONTHLY, anual: ANNUAL, vitalicio: LIFETIME };
export const planName: Record<PlanId, string> = { mensal: 'Mensal', anual: 'Anual', vitalicio: 'Vitalício' };
export const isPlan = (value: unknown): value is PlanId =>
  value === 'mensal' || value === 'anual' || value === 'vitalicio';
/** What the account can do now: a paid plan, the one-month free trial, or nothing (blocked). */
export type Access = {
  status: 'pago' | 'teste' | 'expirado';
  plan: PlanId | null;
  planExpiresAt: string | null;
  trialEndsAt: string;
  daysLeft: number;
  canCancel: boolean;
};
