export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function addMonths(date: string, months: number, day = Number(date.slice(8, 10))): string {
  const d = new Date(date + 'T12:00:00Z');
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
export function splitInstallments(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 2 || count > 360 || total < BigInt(count))
    throw new Error('Parcelamento inválido');
  const base = total / BigInt(count);
  return [total - base * BigInt(count - 1), ...Array<bigint>(count - 1).fill(base)];
}
export const effect = (tx: { type: string; value: bigint; applied: boolean }): bigint =>
  tx.applied ? (tx.type === 'income' ? tx.value : -tx.value) : 0n;
export function statementPeriod(closingDay: number | null, now: string): { from: string; to: string } {
  if (!closingDay) return { from: now.slice(0, 7) + '-01', to: addMonths(now, 0, 31) };
  let to = addMonths(now, 0, closingDay);
  if (now > to) to = addMonths(now, 1, closingDay);
  const d = new Date(addMonths(to, -1, closingDay) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: d.toISOString().slice(0, 10), to };
}
