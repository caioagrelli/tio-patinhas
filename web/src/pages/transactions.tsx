import { useState, type FormEvent } from 'react';
import { api, brl, cents, displayDate, localDate } from '../api';
import { periods, resolvePeriod } from '../charts';
import type { Kind, Saved, Transaction, TxType } from '../types';
import {
  Choose,
  ConfirmDelete,
  Field,
  Loading,
  MoneyInput,
  PageHeader,
  href,
  installmentLabel,
  useApp,
  useData,
  type Flash,
} from '../ui';

const words = (type: TxType) =>
  type === 'expense'
    ? {
        list: 'gastos',
        create: 'gastos/novo',
        title: 'Gastos',
        singular: 'gasto',
        subtitle: 'Histórico de saídas: à vista, parceladas e fixas.',
        button: 'Adicionar gasto',
      }
    : {
        list: 'entradas',
        create: 'entradas/nova',
        title: 'Entradas',
        singular: 'entrada',
        subtitle: 'Histórico de entradas: únicas e fixas.',
        button: 'Adicionar entrada',
      };
const kinds = (type: TxType): [Kind, string][] =>
  type === 'expense'
    ? [
        ['avista', 'À vista'],
        ['parcelado', 'Parcelado'],
        ['fixo', 'Fixo'],
      ]
    : [
        ['avista', 'Única'],
        ['fixo', 'Fixa'],
      ];
const usesCard = (kind?: string) => kind === 'credito' || kind === 'debito';
export const warningsFlash = (saved: Saved): Flash[] => (saved.warnings ?? []).map(text => ({ kind: 'warning', text }));

export function TransactionList({ type }: { type: TxType }) {
  const { route, catalog, go } = useApp(),
    w = words(type),
    q = route.query;
  const { period, from, to } = resolvePeriod(q);
  const kind = q.get('kind') || '',
    param = type === 'expense' ? 'category' : 'income_type',
    selected = q.get(param) || '';
  const params = new URLSearchParams({
    type,
    ...(from && to ? { from, to } : {}),
    ...(kind ? { kind } : {}),
    ...(selected ? { [type === 'expense' ? 'categoryId' : 'incomeTypeId']: selected } : {}),
  });
  const { data, error } = useData<Transaction[]>('/transactions?' + params);
  const [start, setStart] = useState(q.get('start_date') || from || ''),
    [end, setEnd] = useState(q.get('end_date') || to || '');
  const filter = (changes: Record<string, string>) => {
    const next = Object.fromEntries([...q.entries(), ...Object.entries(changes)].filter(([, v]) => v));
    if (next.period !== 'personalizado') {
      delete next.start_date;
      delete next.end_date;
    }
    go(href(w.list, next).slice(2));
  };
  const options = type === 'expense' ? (catalog?.categories ?? []) : (catalog?.incomeTypes ?? []);
  const total = (data ?? []).reduce((s, t) => s + t.value, 0),
    forecast = (data ?? []).filter(t => !t.applied).reduce((s, t) => s + t.value, 0);
  return (
    <>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        <a className="button" href={href(w.create)}>
          + {w.button}
        </a>
      </PageHeader>
      <div className="filters compact">
        <select aria-label="Período" value={period} onChange={e => filter({ period: e.target.value })}>
          {periods.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {period === 'personalizado' && (
          <span className="date-range">
            <input type="date" aria-label="De" value={start} onChange={e => setStart(e.target.value)} />
            <span className="muted">até</span>
            <input type="date" aria-label="Até" value={end} onChange={e => setEnd(e.target.value)} />
            <button type="button" onClick={() => filter({ start_date: start, end_date: end })}>
              Aplicar
            </button>
          </span>
        )}
        <select aria-label="Modalidade" value={kind} onChange={e => filter({ kind: e.target.value })}>
          <option value="">Todas as modalidades</option>
          {kinds(type).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label={type === 'income' ? 'Tipo de entrada' : 'Categoria'}
          value={selected}
          onChange={e => filter({ [param]: e.target.value })}
        >
          <option value="">{type === 'income' ? 'Todos os tipos' : 'Todas as categorias'}</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>
              {o.icon} {o.name}
            </option>
          ))}
        </select>
        {(kind || selected || period !== 'mes_atual') && (
          <a className="link" href={href(w.list)}>
            Limpar filtros
          </a>
        )}
      </div>
      <div className="total-strip panel">
        <span className="muted">Total no período</span>
        <strong>{brl(total)}</strong>
        {forecast > 0 && (
          <small className="muted">
            inclui {brl(forecast)} previsto(s) — ainda não {type === 'income' ? 'recebido(s)' : 'pago(s)'}
          </small>
        )}
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="panel list tx-list">
          {data.length ? (
            data.map(t => (
              <div className={'record-row tx-row' + (t.applied ? '' : ' is-planned')} key={t.id}>
                <div className="row-main">
                  <span className="row-icon tile">
                    {type === 'income' ? t.incomeType?.icon || '💵' : t.category?.icon || '💳'}
                  </span>
                  <div className="row-text">
                    <p className="row-title">
                      <span className="title-text">{t.description || '(sem descrição)'}</span>
                      {t.installmentNumber ? (
                        <span className="badge kind-parcelado">
                          <span className="long">Parcela </span>
                          {installmentLabel(t)}
                        </span>
                      ) : (
                        t.kind === 'fixo' && <span className="badge kind-fixo">Fixo</span>
                      )}
                    </p>
                    <small>
                      {type === 'income' ? t.incomeType?.name || 'Sem tipo' : t.category?.name || 'Sem categoria'} ·{' '}
                      <span className="long">{displayDate(t.date)}</span>
                      <span className="short">{displayDate(t.date).slice(0, 5)}</span>
                      <span className="extra">
                        {t.paymentMethod ? ` · ${t.paymentMethod.name}` : ''}
                        {t.card ? ` · ${t.card.name}` : ''}
                      </span>
                    </small>
                  </div>
                </div>
                <div className="row-side">
                  <strong className={'tx-value' + (type === 'income' ? ' positive' : '')}>{brl(t.value)}</strong>
                  <div className="row-actions">
                    <a
                      className="edit-link"
                      href={href(`${w.list}/${t.id}/editar`)}
                      aria-label={`Editar ${t.description || 'lançamento'}`}
                      title="Editar"
                    >
                      <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">Nenhum lançamento encontrado para esse filtro.</div>
          )}
        </div>
      )}
    </>
  );
}

const text = (f: FormData, key: string) => String(f.get(key) ?? '');
const ref = (f: FormData, key: string) => text(f, key) || null;

/** Card question shown only for card payment methods (Django's "Qual cartão?"). */
export function PaymentFields({ method: initialMethod, card }: { method?: string | null; card?: string | null }) {
  const { catalog } = useApp();
  const [method, setMethod] = useState(initialMethod || '');
  const kind = catalog?.paymentMethods.find(m => m.id === method)?.kind;
  return (
    <div className="form-row">
      <Field
        label="Forma de pagamento"
        aside={
          <a className="link" href={href('configuracoes/pagamento')}>
            Gerenciar formas →
          </a>
        }
      >
        <Choose
          name="paymentMethodId"
          rows={catalog?.paymentMethods ?? []}
          value={method}
          empty="Selecione…"
          onChange={setMethod}
        />
      </Field>
      {usesCard(kind) && (
        <Field label="Qual cartão?">
          {catalog?.cards.length ? (
            <Choose
              name="cardId"
              rows={catalog.cards}
              value={card}
              empty="Selecione o cartão…"
              required={kind === 'credito'}
            />
          ) : (
            <p className="muted">
              Nenhum cartão cadastrado.{' '}
              <a className="link" href={href('configuracoes/cartoes/novo')}>
                Cadastrar cartão
              </a>
            </p>
          )}
        </Field>
      )}
    </div>
  );
}

export function TransactionForm({ type, id }: { type: TxType; id?: string }) {
  const { catalog, go } = useApp(),
    w = words(type);
  const existing = useData<Transaction>(id ? '/transactions/' + id : null);
  const [kind, setKind] = useState<Kind>('avista'),
    [total, setTotal] = useState(''),
    [count, setCount] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (id && !existing.data) return <Loading error={existing.error} />;
  const row = existing.data;
  const installmentText =
    kind === 'parcelado' && Number(total) > 0 && Number(count) >= 2
      ? `${count}x de ${brl(Math.round((Number(total) * 100) / Number(count)))} — uma parcela por mês, a partir da data escolhida.`
      : '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const value = cents(text(f, 'value')),
        date = text(f, 'date');
      const body = {
        type,
        kind: id ? 'avista' : kind,
        value,
        description: text(f, 'description'),
        date,
        ...(type === 'expense'
          ? { categoryId: ref(f, 'categoryId'), paymentMethodId: ref(f, 'paymentMethodId'), cardId: ref(f, 'cardId') }
          : { incomeTypeId: ref(f, 'incomeTypeId') }),
        ...(!id && kind === 'parcelado' ? { installments: Number(text(f, 'installments')) } : {}),
        ...(!id && kind === 'fixo' ? { endDate: ref(f, 'endDate') } : {}),
      };
      if (!id && kind === 'fixo' && body.endDate && body.endDate < date)
        throw new Error('A data final precisa ser depois do início.');
      setBusy(true);
      const saved = await api<Saved>('/transactions' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
      const n = Number(text(f, 'installments'));
      const message = id
        ? 'Lançamento atualizado!'
        : kind === 'parcelado'
          ? `Compra parcelada em ${n}x de ${brl(Math.round(value / n))} registrada!`
          : kind === 'fixo'
            ? type === 'expense'
              ? `Gasto fixo cadastrado! Ele será lançado todo dia ${Number(date.slice(8))}.`
              : `Entrada fixa cadastrada! Ela será lançada todo dia ${Number(date.slice(8))}.`
            : type === 'expense'
              ? 'Gasto salvo com sucesso!'
              : 'Entrada salva com sucesso!';
      go(w.list, [{ kind: 'success', text: message }, ...warningsFlash(saved)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <h1>
        {id ? 'Editar' : type === 'income' ? 'Nova' : 'Novo'} {w.singular}
      </h1>
      <p className="muted form-subtitle">Preencha os dados do lançamento.</p>
      {row?.planId && (
        <div className="notice-box">
          Esta é a parcela <strong>{installmentLabel(row)}</strong> de "{row.plan?.description || 'parcelamento'}". As
          mudanças valem só para ela —{' '}
          <a className="link" href={href(`financas/parcelamentos/${row.planId}/editar`)}>
            editar o parcelamento inteiro
          </a>
          .
        </div>
      )}
      {row?.recurrenceId && (
        <div className="notice-box">
          Este lançamento foi gerado por um fixo mensal. As mudanças valem só para este mês —{' '}
          <a className="link" href={href(`financas/fixos/${row.recurrenceId}/editar`)}>
            editar o fixo
          </a>
          .
        </div>
      )}
      <form onSubmit={submit} className="form-grid">
        {!id && (
          <fieldset className="kind-field">
            <legend>Como é esse lançamento?</legend>
            <div className="kind-choice">
              {(type === 'expense'
                ? [
                    ['avista', 'À vista'],
                    ['parcelado', 'Parcelado'],
                    ['fixo', 'Fixo todo mês'],
                  ]
                : [
                    ['avista', 'Única'],
                    ['fixo', 'Fixa todo mês'],
                  ]
              ).map(([v, l]) => (
                <label key={v} className={kind === v ? 'selected' : ''}>
                  <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v as Kind)} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className={'form-row' + (kind !== 'avista' ? ' three' : '')}>
          <Field
            label={
              kind === 'parcelado' ? 'Valor total da compra (R$)' : kind === 'fixo' ? 'Valor mensal (R$)' : 'Valor (R$)'
            }
          >
            <MoneyInput value={row?.value} onInput={setTotal} />
          </Field>
          {kind === 'parcelado' && (
            <Field label="Nº de parcelas">
              <input
                name="installments"
                type="number"
                min={2}
                max={360}
                required
                placeholder="Ex: 10"
                onInput={e => setCount(e.currentTarget.value)}
              />
            </Field>
          )}
          <Field
            label={
              kind === 'parcelado' ? 'Data da 1ª parcela' : kind === 'fixo' ? 'Primeiro mês (dia que repete)' : 'Data'
            }
          >
            <input
              name="date"
              type="date"
              required
              defaultValue={row?.date || localDate()}
              min="1900-01-01"
              max="2200-12-31"
            />
          </Field>
          {kind === 'fixo' && (
            <Field label="Termina em (opcional)">
              <input
                name="endDate"
                type="date"
                min="1900-01-01"
                max="2200-12-31"
                title="Deixe vazio para repetir todo mês sem data para acabar."
              />
            </Field>
          )}
        </div>
        {installmentText && <p className="hint">{installmentText}</p>}
        {kind === 'fixo' && (
          <p className="hint muted-hint">Sem data final, ele se repete todo mês sem data para acabar.</p>
        )}
        <div className="form-row">
          <Field label="Descrição">
            <input
              name="description"
              maxLength={255}
              defaultValue={row?.description}
              placeholder={type === 'income' ? 'Ex: Salário de outubro' : 'Ex: Mercado da semana'}
            />
          </Field>
          {type === 'expense' ? (
            <Field label="Categoria">
              <Choose
                name="categoryId"
                rows={catalog?.categories ?? []}
                value={row?.categoryId}
                empty="Sem categoria"
              />
            </Field>
          ) : (
            <Field
              label="Tipo de entrada"
              aside={
                <a className="link" href={href('configuracoes/entradas')}>
                  Gerenciar tipos →
                </a>
              }
            >
              <Choose
                name="incomeTypeId"
                rows={catalog?.incomeTypes ?? []}
                value={row?.incomeTypeId}
                empty="Sem tipo"
              />
            </Field>
          )}
        </div>
        {type === 'expense' && <PaymentFields method={row?.paymentMethodId} card={row?.cardId} />}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions start">
          <button disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <a className="button secondary" href={href(w.list)}>
            Cancelar
          </a>
          {id && (
            <a className="link danger delete-link" href={href(`lancamentos/${id}/excluir`)}>
              Excluir lançamento
            </a>
          )}
        </div>
      </form>
    </div>
  );
}

export function TransactionDelete({ id }: { id: string }) {
  const { go } = useApp();
  const { data, error } = useData<Transaction>('/transactions/' + id);
  if (!data) return <Loading error={error} />;
  const list = words(data.type).list;
  return (
    <ConfirmDelete
      title="Excluir lançamento"
      cancel={list}
      detail={
        <>
          "{data.description || (data.type === 'income' ? 'Entrada' : 'Gasto')}"
          {data.installmentNumber ? ` (parcela ${installmentLabel(data)})` : ''} — {brl(data.value)} em{' '}
          {displayDate(data.date)}.{' '}
          {data.applied
            ? `O valor será ${data.type === 'income' ? 'removido do' : 'devolvido ao'} seu saldo.`
            : 'Ele ainda é previsto, então o saldo não muda.'}
          {data.recurrenceId ? ' O fixo mensal continua ativo para os próximos meses.' : ''}
        </>
      }
      onConfirm={async f => {
        if (data.planId && f.get('escopo') === 'plano') {
          await api('/plans/' + data.planId, 'DELETE');
          go(list, [{ kind: 'success', text: 'Parcelamento inteiro excluído.' }]);
        } else {
          await api('/transactions/' + id, 'DELETE');
          go(list, [{ kind: 'success', text: 'Lançamento excluído.' }]);
        }
      }}
    >
      {data.planId && (
        <div className="radio-list">
          <label>
            <input type="radio" name="escopo" value="parcela" defaultChecked /> Só esta parcela
          </label>
          <label>
            <input type="radio" name="escopo" value="plano" /> O parcelamento inteiro ({data.plan?.installments}{' '}
            parcelas)
          </label>
        </div>
      )}
    </ConfirmDelete>
  );
}
