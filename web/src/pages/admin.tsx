import { useState, type FormEvent } from 'react';
import { api, brl, displayDate } from '../api';
import { planName, type Access, type PlanId } from '../../../shared/plans';
import { Back, Breakdown, Field, Loading, PageHeader, href, useApp, useData } from '../ui';

type Overview = {
  users: { total: number; teste: number; pago: number; expirado: number; inactive: number; newThisMonth: number };
  revenue: { total: number; month: number; salesTotal: number; salesMonth: number; pendingCheckouts: number };
  plans: { plan: PlanId; active: number; sales: number; revenue: number }[];
  recent: {
    id: string;
    plan: PlanId;
    kind: string;
    amount: number;
    appliedAt: string;
    /** Null when the buyer deleted their account. */
    user: { id: string; name: string; username: string } | null;
  }[];
};
type Row = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  createdAt: string;
  plan: string | null;
  planExpiresAt: string | null;
  active: boolean;
  isAdmin: boolean;
  google: boolean;
  transactions: number;
  access: Access;
};
type Detail = Row & {
  balance: number;
  hasSubscription: boolean;
  _count: { transactions: number; boxes: number };
  payments: {
    id: string;
    plan: PlanId;
    kind: string;
    amount: number;
    status: string;
    appliedAt: string | null;
    createdAt: string;
  }[];
};

const statusLabel: Record<Access['status'], string> = { pago: 'Pagante', teste: 'Em teste', expirado: 'Expirado' };
const kindLabel: Record<string, string> = { order: 'Pedido', subscription: 'Assinatura', renewal: 'Renovação' };
const day = (iso: string | null) => (iso ? displayDate(iso.slice(0, 10)) : '—');
function StatusBadge({ access, active }: { access: Access; active: boolean }) {
  if (!active) return <span className="badge admin-badge off">Desativada</span>;
  return (
    <span className={'badge admin-badge ' + access.status}>
      {access.status === 'pago' && access.plan ? planName[access.plan] : statusLabel[access.status]}
    </span>
  );
}
const validity = (u: { plan: string | null; planExpiresAt: string | null; access: Access }) =>
  u.access.status === 'pago'
    ? u.plan === 'vitalicio'
      ? 'para sempre'
      : `até ${day(u.planExpiresAt)}`
    : u.access.status === 'teste'
      ? `teste até ${day(u.access.trialEndsAt)}`
      : `teste acabou em ${day(u.access.trialEndsAt)}`;

export function AdminPage() {
  const { route, go } = useApp();
  const overview = useData<Overview>('/admin/overview', route);
  const q = route.query.get('q') ?? '',
    status = route.query.get('status') ?? '';
  const users = useData<Row[]>(
    '/admin/users?' + new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }),
  );
  const [search, setSearch] = useState(q);
  const o = overview.data;
  return (
    <>
      <PageHeader title="Painel do admin" subtitle="Usuários, assinaturas e faturamento do CRAB FINANCE." />
      {!o ? (
        <Loading error={overview.error} />
      ) : (
        <>
          <div className="summary admin-summary">
            <article className="stat accent">
              <p>Faturamento total</p>
              <strong>{brl(o.revenue.total)}</strong>
              <small>{o.revenue.salesTotal} vendas confirmadas</small>
            </article>
            <article className="stat">
              <p>Faturamento do mês</p>
              <strong className="positive">{brl(o.revenue.month)}</strong>
              <small>{o.revenue.salesMonth} vendas este mês</small>
            </article>
            <article className="stat">
              <p>Usuários</p>
              <strong>{o.users.total}</strong>
              <small>
                {o.users.newThisMonth} novos este mês · {o.users.inactive} desativados
              </small>
            </article>
            <article className="stat">
              <p>Pagantes</p>
              <strong>{o.users.pago}</strong>
              <small>
                {o.users.teste} em teste · {o.users.expirado} expirados
              </small>
            </article>
          </div>
          <div className="two-columns">
            <Breakdown
              title="Assinantes ativos por plano"
              empty="Ninguém com plano pago ainda."
              rows={o.plans
                .filter(p => p.active)
                .map(p => ({
                  name: planName[p.plan],
                  color: p.plan === 'anual' ? '#f64301' : p.plan === 'mensal' ? '#4fd4ff' : '#ff3b5c',
                  value: p.revenue,
                  count: p.active,
                  percent: o.users.pago ? Math.round((p.active * 1000) / o.users.pago) / 10 : 0,
                }))}
            />
            <section className="panel">
              <h2>Vendas por plano</h2>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Vendas por plano">
                <table>
                  <thead>
                    <tr>
                      <th>Plano</th>
                      <th className="right">Ativos</th>
                      <th className="right">Vendas</th>
                      <th className="right">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.plans.map(p => (
                      <tr key={p.plan}>
                        <td>{planName[p.plan]}</td>
                        <td className="right">{p.active}</td>
                        <td className="right">{p.sales}</td>
                        <td className="right">{brl(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                {o.revenue.pendingCheckouts} pagamento(s) iniciado(s) ainda sem confirmação.
              </p>
            </section>
          </div>
          <section className="panel">
            <h2>Vendas recentes</h2>
            {o.recent.length ? (
              <div className="list">
                {o.recent.map(s => (
                  <div className="record-row" key={s.id}>
                    <div>
                      <strong>{s.user?.name ?? 'Conta excluída'}</strong>
                      <small>
                        {s.user ? `@${s.user.username} · ` : ''}Plano {planName[s.plan]} · {kindLabel[s.kind] ?? s.kind}{' '}
                        · {day(s.appliedAt)}
                      </small>
                    </div>
                    <div className="row-side">
                      <strong className="positive">{brl(s.amount)}</strong>
                      {s.user && (
                        <a className="link" href={href('admin/usuarios/' + s.user.id)}>
                          Ver usuário
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Nenhuma venda confirmada ainda.</p>
            )}
          </section>
        </>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>Usuários</h2>
        </div>
        <form
          className="filters compact"
          onSubmit={e => {
            e.preventDefault();
            go(href('admin', { q: search, status }).slice(2));
          }}
        >
          <input
            type="search"
            placeholder="Buscar por nome, usuário ou e-mail"
            aria-label="Buscar usuário"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            aria-label="Situação"
            value={status}
            onChange={e => go(href('admin', { q, status: e.target.value }).slice(2))}
          >
            <option value="">Todas as situações</option>
            <option value="pago">Pagantes</option>
            <option value="teste">Em teste</option>
            <option value="expirado">Expirados</option>
          </select>
          <button>Buscar</button>
          {(q || status) && (
            <a className="link" href={href('admin')}>
              Limpar
            </a>
          )}
        </form>
        {!users.data ? (
          <Loading error={users.error} />
        ) : users.data.length ? (
          <div className="list">
            {users.data.map(u => (
              <a className="record-row admin-user" key={u.id} href={href('admin/usuarios/' + u.id)}>
                <div className="row-text">
                  <p className="row-title">
                    <span className="title-text">{u.name}</span>
                    {u.isAdmin && <span className="badge">Admin</span>}
                  </p>
                  <small>
                    @{u.username}
                    {u.email ? ` · ${u.email}` : ''}
                    {u.google ? ' · Google' : ''} · desde {day(u.createdAt)} · {u.transactions} lançamentos
                  </small>
                </div>
                <div className="row-side">
                  <StatusBadge access={u.access} active={u.active} />
                  <small className="muted">{validity(u)}</small>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum usuário encontrado.</p>
        )}
      </section>
    </>
  );
}

export function AdminUser({ id }: { id: string }) {
  const { user: me } = useApp();
  const [version, setVersion] = useState(0);
  const { data, error } = useData<Detail>('/admin/users/' + id, version);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [inThirtyDays] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  if (!data) return <Loading error={error} />;
  const currentPlan = plan ?? data.plan ?? '';
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'ok', text: label });
      setPlan(null);
      setVersion(v => v + 1);
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      chosen = String(f.get('plan') || '') || null;
    void run('Plano atualizado.', () =>
      api(`/admin/users/${id}`, 'PATCH', {
        plan: chosen,
        planExpiresAt: chosen && chosen !== 'vitalicio' ? String(f.get('planExpiresAt') || '') || null : null,
      }),
    );
  };
  const adjust = (days: number) =>
    run(`Validade ${days > 0 ? 'aumentada' : 'reduzida'} em ${Math.abs(days)} dias.`, () =>
      api(`/admin/users/${id}/adjust`, 'POST', { days }),
    );
  const confirmRun = (question: string, label: string, path: string) => {
    if (confirm(question)) void run(label, () => api(path, 'POST'));
  };
  const expires = data.planExpiresAt?.slice(0, 10) ?? inThirtyDays;
  return (
    <>
      <Back to="admin" label="Painel do admin" />
      <PageHeader
        title={data.name}
        subtitle={
          <>
            @{data.username}
            {data.email ? ` · ${data.email}` : ''} · conta criada em {day(data.createdAt)}
          </>
        }
      >
        <StatusBadge access={data.access} active={data.active} />
      </PageHeader>
      {message && (
        <div
          className={'flash ' + (message.kind === 'ok' ? 'success' : 'error')}
          role={message.kind === 'ok' ? 'status' : 'alert'}
        >
          {message.text}
        </div>
      )}
      <div className="summary">
        <article className="stat">
          <p>Situação</p>
          <strong className="admin-stat">{data.active ? statusLabel[data.access.status] : 'Desativada'}</strong>
          <small>{validity(data)}</small>
        </article>
        <article className="stat">
          <p>Pago até hoje</p>
          <strong>
            {brl(
              data.payments
                .filter(p => p.appliedAt && ['order', 'subscription', 'renewal'].includes(p.kind))
                .reduce((s, p) => s + p.amount, 0),
            )}
          </strong>
        </article>
        <article className="stat">
          <p>Uso</p>
          <strong>{data._count.transactions}</strong>
          <small>lançamentos · {data._count.boxes} cofrinhos</small>
        </article>
      </div>
      <div className="two-columns">
        <section className="panel">
          <h2>Plano</h2>
          <form className="form-grid" onSubmit={save}>
            <div className="form-row">
              <Field label="Plano">
                <select name="plan" value={currentPlan} onChange={e => setPlan(e.target.value)}>
                  <option value="">Sem plano (só o teste grátis)</option>
                  <option value="mensal">Mensal</option>
                  <option value="anual">Anual</option>
                  <option value="vitalicio">Vitalício</option>
                </select>
              </Field>
              {(currentPlan === 'mensal' || currentPlan === 'anual') && (
                <Field label="Válido até">
                  <input name="planExpiresAt" type="date" required defaultValue={expires} key={expires} />
                </Field>
              )}
            </div>
            <div className="actions start">
              <button disabled={busy}>Salvar plano</button>
            </div>
          </form>
          {(data.plan === 'mensal' || data.plan === 'anual') && (
            <>
              <h3 className="admin-sub">Ajustar validade</h3>
              <div className="admin-actions">
                {[
                  [-30, '− 30 dias'],
                  [-7, '− 7 dias'],
                  [7, '+ 7 dias'],
                  [30, '+ 30 dias'],
                  [365, '+ 1 ano'],
                ].map(([d, l]) => (
                  <button
                    key={d}
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void adjust(d as number)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Ações</h2>
          <div className="admin-actions column">
            {data.hasSubscription && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  confirmRun(
                    'Cancelar a assinatura mensal no Mercado Pago? As próximas cobranças param; o acesso continua até o fim do período pago.',
                    'Assinatura cancelada no Mercado Pago.',
                    `/admin/users/${id}/cancel-subscription`,
                  )
                }
              >
                Cancelar assinatura no Mercado Pago
              </button>
            )}
            {data.access.status === 'pago' && (
              <button
                type="button"
                className="secondary danger-text"
                disabled={busy}
                onClick={() =>
                  confirmRun(
                    'Encerrar o acesso pago agora? O usuário volta ao teste grátis (se ainda estiver no primeiro mês) ou fica bloqueado.',
                    'Acesso encerrado.',
                    `/admin/users/${id}/end-access`,
                  )
                }
              >
                Encerrar acesso agora
              </button>
            )}
            {data.id !== me.id && (
              <button
                type="button"
                className={data.active ? 'destructive' : ''}
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      data.active ? 'Desativar esta conta? A pessoa não consegue mais entrar.' : 'Reativar esta conta?',
                    )
                  )
                    void run(data.active ? 'Conta desativada.' : 'Conta reativada.', () =>
                      api(`/admin/users/${id}`, 'PATCH', { active: !data.active }),
                    );
                }}
              >
                {data.active ? 'Desativar conta' : 'Reativar conta'}
              </button>
            )}
            {!data.hasSubscription && data.access.status !== 'pago' && data.id === me.id && (
              <p className="muted small">Nenhuma ação disponível para a sua própria conta.</p>
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Pagamentos</h2>
        {data.payments.length ? (
          <div className="list">
            {data.payments.map(p => (
              <div className="record-row" key={p.id}>
                <div>
                  <strong>
                    Plano {planName[p.plan]} · {kindLabel[p.kind] ?? p.kind}
                  </strong>
                  <small>
                    Criado em {day(p.createdAt)} · status: {p.status}
                    {p.appliedAt ? ` · confirmado em ${day(p.appliedAt)}` : ''}
                  </small>
                </div>
                <strong className={p.appliedAt ? 'positive' : 'muted'}>{brl(p.amount)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum pagamento.</p>
        )}
      </section>
    </>
  );
}
