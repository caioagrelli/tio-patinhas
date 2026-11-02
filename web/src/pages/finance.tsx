import { useCallback, useState, type FormEvent } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { api, brl, cents, displayDate } from '../api';
import { ChartCanvas, fade, legend, moneyTick, themeColors, tooltipMoney } from '../charts';
import type { FinancePage as Data, Plan, Recurrence } from '../types';
import {
  pct,
  Choose,
  ConfirmDelete,
  Empty,
  Field,
  Loading,
  MoneyInput,
  PageHeader,
  Progress,
  Back,
  href,
  monthLabel,
  shortDate,
  useApp,
  useData,
} from '../ui';
import { PaymentFields, warningsFlash } from './transactions';

const monthTitle = (date: string) => {
  const t = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(date.slice(0, 7) + '-15T12:00:00Z'),
  );
  return t[0].toUpperCase() + t.slice(1);
};

function RecurrenceList({ rows, empty }: { rows: Recurrence[]; empty: string }) {
  return (
    <div className="list">
      {rows.length ? (
        rows.map(r => (
          <div className="record-row" key={r.id}>
            <div>
              <p className="row-title">
                {r.type === 'income' ? r.incomeType?.icon || '💵' : r.category?.icon || '📌'}{' '}
                {r.description || '(sem descrição)'}
                {!r.active && <small className="muted"> · pausado</small>}
              </p>
              <small>
                Todo dia {r.dayOfMonth}
                {r.paymentMethod ? ` · ${r.paymentMethod.name}` : ''}
                {r.card ? ` · ${r.card.name}` : ''}
                {r.endDate ? ` · até ${r.endDate.slice(5, 7)}/${r.endDate.slice(0, 4)}` : ''}
              </small>
            </div>
            <div className="row-side">
              <strong className={r.type === 'income' ? 'positive' : ''}>{brl(r.value)}</strong>
              <div className="row-actions">
                <a className="link" href={href(`financas/fixos/${r.id}/editar`)}>
                  Editar
                </a>
                <a className="link danger" href={href(`financas/fixos/${r.id}/excluir`)}>
                  Excluir
                </a>
              </div>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  );
}

export function FinancePage() {
  const { route } = useApp();
  const { data, error } = useData<Data>('/finance', route);
  const projection = data?.projection;
  const build = useCallback((): ChartConfiguration => {
    const c = themeColors(),
      rows = projection ?? [];
    return {
      type: 'bar',
      data: {
        labels: rows.map(r => monthLabel(r.month)),
        datasets: [
          {
            type: 'bar',
            label: 'Entradas',
            data: rows.map(r => r.income / 100),
            backgroundColor: c.accent,
            borderRadius: 6,
          },
          {
            type: 'bar',
            label: 'Saídas',
            data: rows.map(r => r.expense / 100),
            backgroundColor: fade(c.fg, 0.35),
            borderRadius: 6,
          },
          {
            type: 'line',
            label: 'Saldo previsto',
            data: rows.map(r => r.balance / 100),
            borderColor: '#4fd4ff',
            backgroundColor: '#4fd4ff',
            tension: 0.3,
            pointRadius: 3,
          },
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
  }, [projection]);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeader
        title="Finanças"
        subtitle="Compromissos do mês, cartões, parcelamentos, fixos e o que vem pela frente."
      >
        <a className="button" href={href('gastos/novo')}>
          + Gasto
        </a>
        <a className="button secondary" href={href('entradas/nova')}>
          + Entrada
        </a>
      </PageHeader>
      <div className="tips">
        {data.tips.map(t => (
          <div key={t.text} className={'tip ' + t.level}>
            <span aria-hidden="true">{t.level === 'alerta' ? '⚠️' : t.level === 'ok' ? '✅' : '💡'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <h2 className="month-title">{monthTitle(data.today)}</h2>
      <div className="summary">
        <article className="stat accent">
          <p>Saldo atual</p>
          <strong>{brl(data.balance)}</strong>
        </article>
        <article className="stat">
          <p>A receber no mês</p>
          <strong className="positive">{brl(data.toReceive)}</strong>
          <small className="muted">de {brl(data.incomeMonth)} em entradas</small>
        </article>
        <article className="stat">
          <p>A pagar no mês</p>
          <strong>{brl(data.toPay)}</strong>
          <small className="muted">de {brl(data.expenseMonth)} em gastos</small>
        </article>
        <article className="stat">
          <p>Saldo previsto no fim do mês</p>
          <strong className={data.projectedBalance < 0 ? 'negative' : ''}>{brl(data.projectedBalance)}</strong>
        </article>
      </div>
      <div className="section-heading spaced">
        <h2>Cartões</h2>
        <a className="link" href={href('configuracoes/cartoes')}>
          Gerenciar →
        </a>
      </div>
      {data.cards.length ? (
        <div className="card-grid">
          {data.cards.map(c => (
            <article className="panel" key={c.id}>
              <div className="card-name">
                <span className="dot" style={{ background: c.color }} />
                <strong>{c.name}</strong>
              </div>
              <p className="muted small">Fatura atual</p>
              <p className="box-amount">{brl(c.invoice)}</p>
              <p className="muted small">
                {shortDate(c.from)} a {shortDate(c.to)}
                {c.dueDate ? ` · vence ${shortDate(c.dueDate)}` : ''}
              </p>
              {c.limit ? (
                <>
                  <div className="limit-line">
                    <span>{pct(c.percent)} do limite</span>
                    <span>Disponível {brl(c.available ?? 0)}</span>
                  </div>
                  <Progress value={c.percent ?? 0} color={(c.percent ?? 0) >= 80 ? 'var(--danger)' : c.color} />
                  <p className="muted small">
                    Usado {brl(c.used)} (fatura + parcelas futuras) de {brl(c.limit)}
                  </p>
                </>
              ) : (
                <p className="muted small">
                  Sem limite cadastrado —{' '}
                  <a className="link" href={href(`configuracoes/cartoes/${c.id}/editar`)}>
                    adicionar
                  </a>
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          <p>Cadastre seus cartões para acompanhar fatura e limite.</p>
          <a className="button" href={href('configuracoes/cartoes/novo')}>
            Cadastrar cartão
          </a>
        </Empty>
      )}
      <h2 className="spaced">Próximos 6 meses</h2>
      <div className="two-columns">
        <section className="panel">
          <ChartCanvas build={build} height={260} label="Projeção de entradas, saídas e saldo nos próximos 6 meses" />
        </section>
        <section className="panel">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Projeção dos próximos 6 meses">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="right">Entra</th>
                  <th className="right">Sai</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.projection.map(r => (
                  <tr key={r.month}>
                    <td>{monthLabel(r.month)}</td>
                    <td className="right positive">{brl(r.income)}</td>
                    <td className="right" title={`Fixos ${brl(r.fixed)} · Parcelas ${brl(r.installments)}`}>
                      {brl(r.expense)}
                    </td>
                    <td className={'right ' + (r.balance < 0 ? 'negative' : '')}>{brl(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Considera fixos ativos e parcelas já lançadas. Gastos do dia a dia não entram.</p>
        </section>
      </div>
      <div className="two-columns spaced">
        <section className="panel">
          <div className="section-heading">
            <h2>Gastos fixos</h2>
            <span className="muted">{brl(data.fixedExpenseTotal)}/mês</span>
          </div>
          {data.commitment !== null && (
            <div className="commitment">
              <div className="limit-line">
                <span>Renda fixa comprometida</span>
                <span>{pct(data.commitment)}</span>
              </div>
              <Progress value={data.commitment} color={data.commitment > 50 ? 'var(--danger)' : undefined} />
            </div>
          )}
          <RecurrenceList
            rows={data.fixedExpenses}
            empty="Nenhum gasto fixo. Ao cadastrar um gasto, escolha “Fixo todo mês”."
          />
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Entradas fixas</h2>
            <span className="muted">{brl(data.fixedIncomeTotal)}/mês</span>
          </div>
          <RecurrenceList
            rows={data.fixedIncomes}
            empty="Nenhuma entrada fixa. Ao cadastrar uma entrada, escolha “Fixa todo mês”."
          />
        </section>
      </div>
      <div className="section-heading spaced">
        <h2>Parcelamentos em andamento</h2>
        <span className="muted">Falta pagar {brl(data.remainingInstallments)}</span>
      </div>
      <div className="panel list">
        {data.activePlans.length ? (
          data.activePlans.map(p => (
            <div className="plan-row" key={p.id}>
              <div className="record-row">
                <div>
                  <p className="row-title">
                    {p.category?.icon || '🛍️'} {p.description || '(sem descrição)'}
                  </p>
                  <small>
                    {p.paid}/{p.installments} pagas · {p.installments}x de {brl(p.installmentValue)}
                    {p.card ? ` · ${p.card.name}` : ''} · termina {monthLabel(p.last, 'long')}
                  </small>
                </div>
                <div className="row-side">
                  <strong>{brl(p.remaining)}</strong>
                  <div className="row-actions">
                    <a className="link" href={href(`financas/parcelamentos/${p.id}/editar`)}>
                      Editar
                    </a>
                    <a className="link danger" href={href(`financas/parcelamentos/${p.id}/excluir`)}>
                      Excluir
                    </a>
                  </div>
                </div>
              </div>
              <Progress value={(p.paid * 100) / p.installments} />
            </div>
          ))
        ) : (
          <div className="empty">Nenhum parcelamento em andamento. Ao cadastrar um gasto, escolha “Parcelado”.</div>
        )}
      </div>
      {data.settledPlans.length > 0 && (
        <details className="settled">
          <summary>Ver {data.settledPlans.length} parcelamento(s) quitado(s)</summary>
          {data.settledPlans.map(p => (
            <div className="movement" key={p.id}>
              <span>
                ✅ {p.description || '(sem descrição)'}{' '}
                <small className="muted">
                  · {p.installments}x · terminou {monthLabel(p.last, 'long')}
                </small>
              </span>
              <span>{brl(p.totalValue)}</span>
            </div>
          ))}
        </details>
      )}
      <h2 className="spaced">Próximos 30 dias</h2>
      <div className="panel list">
        {data.upcoming.length ? (
          data.upcoming.map(t => (
            <div className="record-row" key={t.id}>
              <div className="row-main inline-meta">
                <span className="date-chip">{shortDate(t.date)}</span>
                <span>
                  {t.description || (t.type === 'income' ? 'Entrada' : 'Gasto')}
                  {t.installmentNumber && (
                    <small className="muted">
                      {' '}
                      · parcela {t.installmentNumber}/{t.installments}
                    </small>
                  )}
                  {t.kind === 'fixo' && <small className="muted"> · fixo</small>}
                  {t.card && <small className="muted"> · {t.card}</small>}
                </span>
              </div>
              <strong className={t.type === 'income' ? 'positive' : ''}>
                {t.type === 'income' ? '+' : '-'} {brl(t.value)}
              </strong>
            </div>
          ))
        ) : (
          <div className="empty">Nada previsto para os próximos 30 dias.</div>
        )}
      </div>
    </>
  );
}

export function RecurrenceForm({ id }: { id: string }) {
  const { catalog, go } = useApp();
  const { data, error } = useData<Recurrence[]>('/recurrences');
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const rec = data?.find(r => r.id === id);
  if (!rec) return <Loading error={error || (data ? 'Lançamento fixo não encontrado.' : '')} />;
  const income = rec.type === 'income';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure('');
    setBusy(true);
    const f = new FormData(e.currentTarget),
      get = (k: string) => String(f.get(k) ?? '') || null;
    try {
      const saved = await api<{ warnings?: string[] }>('/recurrences/' + id, 'PATCH', {
        type: rec!.type,
        value: cents(String(f.get('value'))),
        description: String(f.get('description') ?? ''),
        dayOfMonth: Number(f.get('dayOfMonth')),
        startDate: rec!.startDate,
        endDate: get('endDate'),
        active: f.has('active'),
        categoryId: income ? null : get('categoryId'),
        incomeTypeId: income ? get('incomeTypeId') : null,
        paymentMethodId: income ? null : get('paymentMethodId'),
        cardId: income ? null : get('cardId'),
      });
      go('financas', [
        { kind: 'success', text: 'Lançamento fixo atualizado! As mudanças valem para os próximos meses.' },
        ...warningsFlash(saved),
      ]);
    } catch (err) {
      setFailure((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <Back to="financas" label="Finanças" />
      <h1>Editar {income ? 'entrada fixa' : 'gasto fixo'}</h1>
      <p className="muted">
        Começou em {displayDate(rec.startDate)}. As mudanças valem para os próximos meses; os lançamentos já gerados
        podem ser editados um a um na lista de {income ? 'entradas' : 'gastos'}.
      </p>
      <form onSubmit={submit} className="form-grid">
        <Field label="Valor mensal (R$)">
          <MoneyInput value={rec.value} />
        </Field>
        <Field label="Descrição">
          <input name="description" maxLength={255} defaultValue={rec.description} />
        </Field>
        {income ? (
          <Field label="Tipo de entrada">
            <Choose name="incomeTypeId" rows={catalog?.incomeTypes ?? []} value={rec.incomeTypeId} empty="Sem tipo" />
          </Field>
        ) : (
          <>
            <Field label="Categoria">
              <Choose name="categoryId" rows={catalog?.categories ?? []} value={rec.categoryId} empty="Sem categoria" />
            </Field>
            <PaymentFields method={rec.paymentMethodId} card={rec.cardId} />
          </>
        )}
        <div className="form-row">
          <Field label="Dia do mês">
            <input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={rec.dayOfMonth} />
          </Field>
          <Field label="Termina em (opcional)">
            <input name="endDate" type="date" defaultValue={rec.endDate ?? ''} min={rec.startDate} />
          </Field>
        </div>
        <label className="checkbox">
          <input name="active" type="checkbox" defaultChecked={rec.active} /> Ativo (continua gerando todo mês)
        </label>
        {failure && (
          <p role="alert" className="error">
            {failure}
          </p>
        )}
        <div className="actions start">
          <button disabled={busy}>Salvar</button>
          <a className="button secondary" href={href('financas')}>
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}

export function RecurrenceDelete({ id }: { id: string }) {
  const { go } = useApp();
  const { data, error } = useData<Recurrence[]>('/recurrences');
  const rec = data?.find(r => r.id === id);
  if (!rec) return <Loading error={error || (data ? 'Lançamento fixo não encontrado.' : '')} />;
  return (
    <ConfirmDelete
      title="Excluir lançamento fixo"
      name={rec.description || 'Lançamento fixo'}
      cancel="financas"
      detail={`${brl(rec.value)} todo dia ${rec.dayOfMonth}. Os meses já lançados continuam no histórico; os previstos serão removidos.`}
      onConfirm={async () => {
        await api('/recurrences/' + id, 'DELETE');
        go('financas', [{ kind: 'success', text: 'Lançamento fixo excluído. O histórico já lançado foi mantido.' }]);
      }}
    />
  );
}

export function PlanForm({ id }: { id: string }) {
  const { catalog, go } = useApp();
  const { data, error } = useData<Plan[]>('/plans');
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const plan = data?.find(p => p.id === id);
  if (!plan) return <Loading error={error || (data ? 'Parcelamento não encontrado.' : '')} />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure('');
    setBusy(true);
    const f = new FormData(e.currentTarget),
      get = (k: string) => String(f.get(k) ?? '') || null;
    try {
      await api('/plans/' + id, 'PATCH', {
        description: String(f.get('description') ?? ''),
        categoryId: get('categoryId'),
        paymentMethodId: get('paymentMethodId'),
        cardId: get('cardId'),
      });
      go('financas', [{ kind: 'success', text: 'Parcelamento atualizado em todas as parcelas.' }]);
    } catch (err) {
      setFailure((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="two-columns">
      <div className="form-page flush">
        <Back to="financas" label="Finanças" />
        <h1>Editar parcelamento</h1>
        <p className="muted">
          {plan.installments}x — total de {brl(plan.totalValue)}. Estes dados são aplicados a todas as parcelas. Para
          mudar o valor ou a data de uma parcela, edite-a na lista ao lado.
        </p>
        <form onSubmit={submit} className="form-grid">
          <Field label="Descrição">
            <input name="description" maxLength={255} defaultValue={plan.description} />
          </Field>
          <Field label="Categoria">
            <Choose name="categoryId" rows={catalog?.categories ?? []} value={plan.categoryId} empty="Sem categoria" />
          </Field>
          <PaymentFields method={plan.paymentMethodId} card={plan.cardId} />
          {failure && (
            <p role="alert" className="error">
              {failure}
            </p>
          )}
          <div className="actions start">
            <button disabled={busy}>Salvar</button>
            <a className="button secondary" href={href('financas')}>
              Cancelar
            </a>
          </div>
        </form>
      </div>
      <section className="panel">
        <h2>Parcelas</h2>
        <div className="list">
          {plan.transactions.map(p => (
            <div className="movement" key={p.id}>
              <span>
                {p.installmentNumber}/{plan.installments}{' '}
                <small className="muted">
                  · {displayDate(p.date)} · {p.applied ? 'paga' : 'prevista'}
                </small>
              </span>
              <span>
                {brl(p.value)}{' '}
                <a className="link" href={href(`gastos/${p.id}/editar`)}>
                  Editar
                </a>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PlanDelete({ id }: { id: string }) {
  const { go } = useApp();
  const { data, error } = useData<Plan[]>('/plans');
  const plan = data?.find(p => p.id === id);
  if (!plan) return <Loading error={error || (data ? 'Parcelamento não encontrado.' : '')} />;
  return (
    <ConfirmDelete
      title="Excluir parcelamento"
      name={plan.description || 'Parcelamento'}
      cancel="financas"
      detail={`${plan.installments}x — total de ${brl(plan.totalValue)}. Todas as parcelas serão excluídas e as já pagas voltam para o saldo.`}
      onConfirm={async () => {
        await api('/plans/' + id, 'DELETE');
        go('financas', [
          { kind: 'success', text: 'Parcelamento excluído. As parcelas já pagas voltaram para o saldo.' },
        ]);
      }}
    />
  );
}
