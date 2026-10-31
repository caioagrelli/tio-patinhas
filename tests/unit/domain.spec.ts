import fc from 'fast-check';
import { addMonths, effect, splitInstallments, statementPeriod, today } from '../../server/src/domain';
import { transactionInput, date, movementInput } from '../../shared/schemas';
import { cents } from '../../web/src/api';
describe('Regras financeiras e propriedades', () => {
  it('divide parcelas sem criar ou perder um centavo (2.000 casos)', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 360 }), fc.bigInt({ min: 360n, max: 999_999_999_999n }), (n, total) => {
      const values = splitInstallments(total, n);
      expect(values).toHaveLength(n);
      expect(values.reduce((s, v) => s + v, 0n)).toBe(total);
      expect(values.every(v => v > 0n)).toBe(true);
      expect(values[0] - values[1]).toBeLessThan(BigInt(n));
    }), { numRuns: 2000 });
  });
  it.each([[10000n, 3, [3334n,3333n,3333n]], [2n, 2, [1n,1n]]])('distribui o resto na primeira parcela', (total, count, expected) => { expect(splitInstallments(total, count)).toEqual(expected); });
  it.each([0, 1, 361, 2.5])('rejeita quantidade inválida %s', n => expect(() => splitInstallments(1000n, n)).toThrow());
  it('ajusta meses curtos e anos bissextos', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2025-12-31', 1)).toBe('2026-01-31');
    expect(addMonths('2025-01-31', -1)).toBe('2024-12-31');
    expect(addMonths('2025-01-31', 2)).toBe('2025-03-31');
  });
  it('mantém a data civil de Recife perto da meia-noite UTC', () => expect(today(new Date('2026-02-01T01:00:00Z'))).toBe('2026-01-31'));
  it('não aplica lançamentos futuros', () => expect(effect({ type: 'income', value: 100n, applied: false })).toBe(0n));
  it('calcula entrada e saída', () => { expect(effect({ type: 'income', value: 100n, applied: true })).toBe(100n); expect(effect({ type: 'expense', value: 100n, applied: true })).toBe(-100n); });
  it('calcula o ciclo da fatura com fechamento', () => {
    expect(statementPeriod(5, '2026-01-05')).toEqual({ from: '2025-12-06', to: '2026-01-05' });
    expect(statementPeriod(5, '2026-01-06')).toEqual({ from: '2026-01-06', to: '2026-02-05' });
    expect(statementPeriod(null, '2024-02-20')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
  it.each(['2026-02-30', '2026-13-01', '2026-2-1', '1800-01-01'])('rejeita data inválida %s', d => expect(date.safeParse(d).success).toBe(false));
  it('rejeita parcelas sem centavos suficientes e entradas parceladas', () => {
    expect(transactionInput.safeParse({ type: 'expense', kind: 'parcelado', value: 2, installments: 3, date: '2026-01-01' }).success).toBe(false);
    expect(transactionInput.safeParse({ type: 'income', kind: 'parcelado', value: 1000, installments: 3, date: '2026-01-01' }).success).toBe(false);
  });
  it('rejeita valores fracionários, negativos, infinitos e campos extras', () => {
    for (const value of [-1, 0, 1.5, NaN, Infinity]) expect(movementInput.safeParse({ type: 'deposit', value }).success).toBe(false);
    expect(movementInput.safeParse({ type: 'deposit', value: 100, userId: 'outro' }).success).toBe(false);
  });
  it('converte entrada decimal em centavos sem erro de ponto flutuante', () => { expect(cents('0.29')).toBe(29); expect(cents('1,23')).toBe(123); expect(cents('9999999999.99')).toBe(999999999999); expect(() => cents('1.001')).toThrow(); });
});
