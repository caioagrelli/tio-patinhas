export class ApiError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { method, signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TioPatinhas' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json() as { message?: string | string[] };
  if (!response.ok) throw new ApiError(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Não foi possível concluir a operação.', response.status);
  return data as T;
}
export const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const displayDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
export function cents(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor positivo com até duas casas decimais.');
  const [whole, fraction = ''] = normalized.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 999_999_999_999) throw new Error('Valor fora do limite permitido.');
  return result;
}
export const decimal = (value?: number | null) => value == null ? '' : (value / 100).toFixed(2);
