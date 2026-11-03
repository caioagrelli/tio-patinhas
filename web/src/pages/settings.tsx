import { useState, type FormEvent } from 'react';
import { api, brl, cents } from '../api';
import type { CardSummary, Named } from '../types';
import { ChangePassword, DeleteAccount } from '../account';
import { ConfirmDelete, Field, Loading, MoneyInput, PageHeader, Progress, Back, href, useApp, useData } from '../ui';

type Tab = { title: string; singular: string; description: string; resource: string; tip?: string; feminine?: boolean };
const tabs: Record<string, Tab> = {
  categorias: {
    title: 'Categorias',
    singular: 'categoria',
    feminine: true,
    resource: 'categories',
    description: 'Categorias dos seus gastos. As padrão do sistema não podem ser editadas.',
    tip: 'Use um emoji como ícone, ex: 🍔 🚌 🎬 🏠 💊 📚',
  },
  pagamento: {
    title: 'Formas de pagamento',
    singular: 'forma de pagamento',
    feminine: true,
    resource: 'payment-methods',
    description: 'Como você paga seus gastos. Formas do tipo cartão perguntam qual cartão foi usado.',
  },
  cartoes: {
    title: 'Cartões',
    singular: 'cartão',
    resource: 'cards',
    description: 'Seus cartões, com limite e datas de fechamento/vencimento da fatura.',
    tip: 'Compras feitas depois do dia de fechamento entram na fatura seguinte.',
  },
  entradas: {
    title: 'Tipos de entrada',
    singular: 'tipo de entrada',
    resource: 'income-types',
    description: 'De onde vem seu dinheiro: salário, freelance, investimentos...',
  },
};
const order: [string, string][] = [
  ['aparencia', 'Aparência'],
  ...Object.entries(tabs).map(([k, t]) => [k, t.title] as [string, string]),
  ['conta', 'Conta'],
];
export const paymentKinds: [string, string][] = [
  ['dinheiro', 'Dinheiro'],
  ['pix', 'Pix'],
  ['debito', 'Cartão de débito'],
  ['credito', 'Cartão de crédito'],
  ['transferencia', 'Transferência'],
  ['boleto', 'Boleto'],
  ['outro', 'Outro'],
];
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const itemsOf = (catalog: ReturnType<typeof useApp>['catalog'], tab: string): Named[] =>
  !catalog
    ? []
    : tab === 'categorias'
      ? catalog.categories
      : tab === 'pagamento'
        ? catalog.paymentMethods
        : tab === 'cartoes'
          ? catalog.cards
          : catalog.incomeTypes;

function Appearance() {
  const { theme, setTheme } = useApp();
  return (
    <>
      <h2>Aparência</h2>
      <p className="muted">Escolha o tema. A preferência fica salva neste navegador.</p>
      <div className="theme-choices">
        {(
          [
            ['dark', '🌙 Escuro'],
            ['light', '☀️ Claro'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={'theme-choice ' + value + (theme === value ? ' active' : '')}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <span className="preview" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="label">{label}</span>
            {theme === value && <small>Em uso</small>}
          </button>
        ))}
      </div>
    </>
  );
}

function Items({ tab }: { tab: string }) {
  const { catalog, route } = useApp();
  const cards = useData<CardSummary[]>(tab === 'cartoes' ? '/cards' : null, route);
  const config = tabs[tab],
    items = itemsOf(catalog, tab);
  const actions = (item: Named) => (
    <div className="row-actions">
      <a className="link" href={href(`configuracoes/${tab}/${item.id}/editar`)}>
        Editar
      </a>
      <a className="link danger" href={href(`configuracoes/${tab}/${item.id}/excluir`)}>
        Excluir
      </a>
    </div>
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>{config.title}</h2>
          <p className="muted">{config.description}</p>
        </div>
        <a className="button" href={href(`configuracoes/${tab}/novo`)}>
          + Adicionar {config.singular}
        </a>
      </div>
      {tab === 'cartoes' ? (
        !cards.data ? (
          <Loading error={cards.error} />
        ) : cards.data.length ? (
          <div className="card-grid">
            {cards.data.map(c => (
              <article className="panel" key={c.id}>
                <div className="section-heading">
                  <div className="card-name">
                    <span className="dot" style={{ background: c.color }} />
                    <strong>{c.name}</strong>
                  </div>
                  {actions(c)}
                </div>
                {c.limit ? (
                  <>
                    <div className="limit-line">
                      <span>Limite usado</span>
                      <span>
                        {brl(c.used)} de {brl(c.limit)}
                      </span>
                    </div>
                    <Progress value={c.percent ?? 0} color={c.color} />
                    <p className="muted small">Disponível: {brl(c.available ?? 0)}</p>
                  </>
                ) : (
                  <p className="muted small">Sem limite cadastrado.</p>
                )}
                <p className="muted small">
                  {c.closingDay ? `Fecha dia ${c.closingDay}` : 'Fatura = mês corrente'}
                  {c.dueDay ? ` · vence dia ${c.dueDay}` : ''}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">Nenhum cartão cadastrado ainda.</div>
        )
      ) : tab === 'pagamento' ? (
        <div className="list">
          {items.length ? (
            items.map(m => (
              <div className="record-row" key={m.id}>
                <div className="row-main">
                  <span className="row-icon">{m.icon}</span>
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      {paymentKinds.find(([k]) => k === m.kind)?.[1]}
                      {m.kind === 'credito' || m.kind === 'debito' ? ' · pergunta o cartão' : ''}
                    </small>
                  </div>
                </div>
                {actions(m)}
              </div>
            ))
          ) : (
            <div className="empty">Nenhuma forma de pagamento cadastrada.</div>
          )}
        </div>
      ) : (
        <div className="item-grid">
          {items.length ? (
            items.map(item => (
              <article className="panel item-card" key={item.id}>
                <div className="box-mini-head">
                  <span className="box-icon">{item.icon}</span>
                  <span className="dot" style={{ background: item.color }} />
                </div>
                <p>
                  <strong>{item.name}</strong>
                </p>
                {tab === 'categorias' ? (
                  <p className="muted small">{item.isDefault ? 'Padrão do sistema' : 'Sua categoria'}</p>
                ) : (
                  <div className="color-bar" style={{ background: item.color }} />
                )}
                {!item.isDefault && actions(item)}
              </article>
            ))
          ) : (
            <div className="empty">Nada cadastrado ainda.</div>
          )}
        </div>
      )}
    </>
  );
}

export function SettingsPage({ tab }: { tab: string }) {
  const { user } = useApp();
  const current = tab in tabs || tab === 'conta' ? tab : 'aparencia';
  return (
    <>
      <PageHeader title="Configurações" subtitle="Personalize o sistema do seu jeito." />
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Seções de configuração">
          {order.map(([key, label]) => (
            <a key={key} href={href('configuracoes/' + key)} aria-current={current === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <section className="panel">
          {current === 'aparencia' ? (
            <Appearance />
          ) : current === 'conta' ? (
            <div className="account-sections">
              <ChangePassword user={user} />
              <DeleteAccount user={user} />
            </div>
          ) : (
            <Items tab={current} />
          )}
        </section>
      </div>
    </>
  );
}

export function SettingsForm({ tab, id }: { tab: string; id?: string }) {
  const { catalog, go, reloadCatalog } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const config = tabs[tab];
  if (!config) return <Loading error="Aba de configuração inexistente." />;
  if (!catalog) return <Loading />;
  const item = id ? itemsOf(catalog, tab).find(i => i.id === id) : undefined;
  if (id && (!item || item.isDefault)) return <Loading error="Item não encontrado ou não editável." />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.currentTarget),
      get = (k: string) => String(f.get(k) ?? '');
    try {
      const body: Record<string, unknown> = { name: get('name') };
      if (tab === 'cartoes')
        Object.assign(body, {
          color: get('color'),
          limit: get('limit') ? cents(get('limit')) : null,
          closingDay: get('closingDay') ? Number(get('closingDay')) : null,
          dueDay: get('dueDay') ? Number(get('dueDay')) : null,
        });
      else {
        body.icon = get('icon');
        if (tab === 'pagamento') body.kind = get('kind');
        else body.color = get('color');
      }
      await api(`/settings/${config.resource}` + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
      reloadCatalog();
      go('configuracoes/' + tab, [
        { kind: 'success', text: `${capital(config.singular)} ${config.feminine ? 'salva' : 'salvo'}!` },
      ]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <Back to={'configuracoes/' + tab} label={config.title} />
      <h1>
        {id ? 'Editar' : 'Adicionar'} {config.singular}
      </h1>
      <p className="muted">{config.tip ?? config.description}</p>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome">
          <input name="name" required maxLength={80} defaultValue={item?.name} />
        </Field>
        {tab === 'pagamento' && (
          <Field label="Tipo" help="Formas do tipo cartão (crédito/débito) perguntam qual cartão foi usado.">
            <select name="kind" defaultValue={item?.kind || 'pix'}>
              {paymentKinds.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}
        {tab === 'cartoes' && (
          <>
            <Field label="Limite (R$)">
              <MoneyInput name="limit" value={item?.limit} required={false} />
            </Field>
            <div className="form-row">
              <Field label="Dia de fechamento">
                <input name="closingDay" type="number" min={1} max={31} defaultValue={item?.closingDay ?? ''} />
              </Field>
              <Field label="Dia de vencimento">
                <input name="dueDay" type="number" min={1} max={31} defaultValue={item?.dueDay ?? ''} />
              </Field>
            </div>
          </>
        )}
        {tab !== 'cartoes' && (
          <Field label="Ícone">
            <input name="icon" maxLength={20} defaultValue={item?.icon || (tab === 'pagamento' ? '💳' : '💰')} />
          </Field>
        )}
        {tab !== 'pagamento' && (
          <Field label="Cor">
            <input name="color" type="color" defaultValue={item?.color || '#f64301'} />
          </Field>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions start">
          <button disabled={busy}>Salvar</button>
          <a className="button secondary" href={href('configuracoes/' + tab)}>
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}

export function SettingsDelete({ tab, id }: { tab: string; id: string }) {
  const { catalog, go, reloadCatalog } = useApp();
  const config = tabs[tab];
  const item = config && catalog ? itemsOf(catalog, tab).find(i => i.id === id) : undefined;
  if (!config || !catalog) return <Loading error={config ? '' : 'Aba de configuração inexistente.'} />;
  if (!item || item.isDefault) return <Loading error="Item não encontrado ou não editável." />;
  return (
    <ConfirmDelete
      title={`Excluir ${config.singular}`}
      name={item.name}
      cancel={'configuracoes/' + tab}
      detail="Os lançamentos que usam este item não serão apagados — só ficarão sem ele."
      onConfirm={async () => {
        await api(`/settings/${config.resource}/${id}`, 'DELETE');
        reloadCatalog();
        go('configuracoes/' + tab, [
          { kind: 'success', text: `${capital(config.singular)} ${config.feminine ? 'excluída' : 'excluído'}.` },
        ]);
      }}
    />
  );
}
