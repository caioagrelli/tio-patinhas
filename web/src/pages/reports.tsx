import { useCallback, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { brl, displayDate } from '../api';
import { ChartCanvas, fade, legend, moneyTick, periods, resolvePeriod, themeColors, tooltipMoney } from '../charts';
import type { Report } from '../types';
import { Breakdown, Loading, pct, PageHeader, href, monthLabel, useApp, useData } from '../ui';

export function ReportsPage() {
  const { route, go } = useApp();
  const { period, from, to } = resolvePeriod(route.query);
  const { data, error } = useData<Report>('/reports?' + new URLSearchParams({ ...(from && to ? { from, to } : {}) }));
  const [chart, setChart] = useState<'doughnut' | 'bar'>('doughnut');
  const [start, setStart] = useState(from ?? ''),
    [end, setEnd] = useState(to ?? '');
  const categories = data?.byCategory,
    evolution = data?.evolution;
  const buildCategories = useCallback((): ChartConfiguration => {
    const c = themeColors(),
      rows = categories ?? [];
    return {
      type: chart,
      data: {
        labels: rows.map(r => `${r.icon} ${r.name}`),
        datasets: [
          {
            label: 'Gastos',
            data: rows.map(r => r.value / 100),
            backgroundColor: rows.map(r => r.color),
            borderColor: c.panel,
            borderWidth: chart === 'doughnut' ? 2 : 0,
            borderRadius: chart === 'bar' ? 6 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { ...legend(c.text), display: chart === 'doughnut' }, tooltip: tooltipMoney },
        scales:
          chart === 'bar'
            ? {
                x: { ticks: { color: c.text }, grid: { color: c.grid } },
                y: { ticks: { color: c.text, callback: moneyTick }, grid: { color: c.grid } },
              }
            : {},
      },
    };
  }, [categories, chart]);
  const buildEvolution = useCallback((): ChartConfiguration => {
    const c = themeColors(),
      rows = evolution ?? [];
    return {
      type: 'bar',
      data: {
        labels: rows.map(r => monthLabel(r.month)),
        datasets: [
          { label: 'Entradas', data: rows.map(r => r.income / 100), backgroundColor: c.accent, borderRadius: 6 },
          { label: 'Gastos', data: rows.map(r => r.expense / 100), backgroundColor: fade(c.fg, 0.35), borderRadius: 6 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: legend(c.text), tooltip: tooltipMoney },
        scales: {
          x: { ticks: { color: c.text }, grid: { display: false } },
          y: { ticks: { color: c.text, callback: moneyTick }, grid: { color: c.grid } },
        },
      },
    };
  }, [evolution]);
  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Entradas, gastos (incluindo fixos e parcelas) e para onde vai o seu dinheiro."
      />
      <div className="pills">
        {periods.map(([v, l]) => (
          <a key={v} href={href('relatorios', { period: v })} aria-current={period === v ? 'true' : undefined}>
            {l}
          </a>
        ))}
      </div>
      {period === 'personalizado' && (
        <form
          className="filters compact"
          onSubmit={e => {
            e.preventDefault();
            go(href('relatorios', { period, start_date: start, end_date: end }).slice(2));
          }}
        >
          <label className="inline-field">
            De <input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </label>
          <label className="inline-field">
            Até <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </label>
          <button>Aplicar</button>
        </form>
      )}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="summary">
            <article className="stat">
              <p>Entradas</p>
              <strong className="positive">{brl(data.income)}</strong>
            </article>
            <article className="stat">
              <p>Gastos</p>
              <strong>{brl(data.expense)}</strong>
            </article>
            <article className="stat">
              <p>Resultado</p>
              <strong className={data.net < 0 ? 'negative' : 'positive'}>
                {data.net > 0 ? '+' : ''}
                {brl(data.net)}
              </strong>
            </article>
            <article className="stat">
              <p>Gastos fixos</p>
              <strong>{brl(data.fixed)}</strong>
              <small className="muted">Parcelas: {brl(data.installments)}</small>
            </article>
          </div>
          <p className="muted small period-note">
            {from && to ? `${displayDate(from)} até ${displayDate(to)}` : 'Todo o histórico'}
            {data.forecastExpense > 0
              ? ` · inclui ${brl(data.forecastExpense)} em gastos previstos (ainda não pagos)`
              : ''}
          </p>
          {data.byCategory.length ? (
            <div className="two-columns">
              <section className="panel">
                <div className="section-heading">
                  <h2>Gastos por categoria</h2>
                  <div className="toggle">
                    <button
                      type="button"
                      className={chart === 'doughnut' ? '' : 'secondary'}
                      onClick={() => setChart('doughnut')}
                    >
                      Pizza
                    </button>
                    <button
                      type="button"
                      className={chart === 'bar' ? '' : 'secondary'}
                      onClick={() => setChart('bar')}
                    >
                      Barras
                    </button>
                  </div>
                </div>
                <ChartCanvas build={buildCategories} height={300} label="Distribuição de gastos por categoria" />
              </section>
              <section className="panel">
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Gastos por categoria">
                  <table>
                    <thead>
                      <tr>
                        <th>Categoria</th>
                        <th className="right">Total</th>
                        <th className="right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCategory.map(r => (
                        <tr key={r.name}>
                          <td>
                            <span className="dot" style={{ background: r.color }} /> {r.icon} {r.name}
                          </td>
                          <td className="right">{brl(r.value)}</td>
                          <td className="right">{pct(r.percent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <div className="empty panel">Nenhum gasto encontrado nesse período.</div>
          )}
          <section className="panel spaced">
            <h2>Evolução — últimos 6 meses</h2>
            <ChartCanvas build={buildEvolution} height={240} label="Entradas e gastos nos últimos 6 meses" />
          </section>
          <div className="two-columns">
            <Breakdown title="À vista × parcelado × fixo" rows={data.byKind} empty="Nenhum gasto no período." />
            <Breakdown title="Por forma de pagamento" rows={data.byPaymentMethod} empty="Nenhum gasto no período." />
            <Breakdown title="Por cartão" rows={data.byCard} empty="Nenhum gasto em cartão no período." />
            <Breakdown title="Entradas por tipo" rows={data.byIncomeType} empty="Nenhuma entrada no período." />
          </div>
          <section className="panel">
            <div className="section-heading">
              <h2>Gastos fixos ativos</h2>
              <span className="muted">
                {brl(data.fixedMonthly)}/mês ·{' '}
                <a className="link" href={href('financas')}>
                  gerenciar →
                </a>
              </span>
            </div>
            {data.fixedExpenses.length ? (
              data.fixedExpenses.map(r => (
                <div className="movement" key={r.id}>
                  <span>
                    {r.category?.icon || '📌'} {r.description || '(sem descrição)'}{' '}
                    <small className="muted">
                      · dia {r.dayOfMonth}
                      {r.card ? ` · ${r.card.name}` : ''}
                    </small>
                  </span>
                  <span>{brl(r.value)}</span>
                </div>
              ))
            ) : (
              <p className="muted">Nenhum gasto fixo ativo.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
