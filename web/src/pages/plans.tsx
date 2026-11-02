import { useState, type FormEvent, type ReactNode } from 'react';
import { brl, displayDate } from '../api';
import { ParticleField } from '../particles';
import { DeleteAccount } from '../account';
import { PixelCrab } from '../login';
import type { User } from '../types';
import { href } from '../ui';
import {
  ANNUAL,
  ANNUAL_INSTALLMENT,
  LIFETIME,
  MONTHLY,
  planName,
  type Access,
  type PlanId,
} from '../../../shared/plans';
import { api } from '../api';

type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  price: string;
  period: string;
  note: string;
  cta: string;
  badge?: string;
  total: number;
  charge: string;
  extras: [string, string][];
};
// Prices in cents. Savings are against 12 months of the monthly plan.
export const annualSavings = Math.round((1 - ANNUAL / (MONTHLY * 12)) * 100);
export const lifetimeBreakEven = Math.ceil(LIFETIME / MONTHLY);
export const plans: Plan[] = [
  {
    id: 'mensal',
    name: 'Mensal',
    tagline: 'Para experimentar sem compromisso.',
    price: brl(MONTHLY),
    period: '/mês',
    note: 'Cobrado todo mês.',
    cta: 'Assinar mensal',
    total: MONTHLY,
    charge: `${brl(MONTHLY)} por mês`,
    extras: [['Flexível', 'Pague mês a mês, sem fidelidade.']],
  },
  {
    id: 'anual',
    name: 'Anual',
    tagline: 'Para organizar o ano inteiro.',
    price: '12x ' + brl(ANNUAL_INSTALLMENT),
    period: '',
    note: `${brl(ANNUAL)} por ano · economize ${annualSavings}% em relação ao mensal`,
    cta: 'Assinar anual',
    badge: 'Mais escolhido',
    total: ANNUAL,
    charge: `12x de ${brl(ANNUAL_INSTALLMENT)} (${brl(ANNUAL)} por ano)`,
    extras: [
      ['Menor preço por mês', `Sai por ${brl(ANNUAL_INSTALLMENT)} ao mês.`],
      ['Um ano de planejamento', 'Acompanhe a projeção e os fixos do ano todo.'],
    ],
  },
  {
    id: 'vitalicio',
    name: 'Vitalício',
    tagline: 'Pague uma vez e use para sempre.',
    price: brl(LIFETIME),
    period: ' único',
    note: 'Sem mensalidade. Um único pagamento.',
    cta: 'Comprar vitalício',
    total: LIFETIME,
    charge: `${brl(LIFETIME)} em pagamento único`,
    extras: [
      ['Acesso para sempre', 'Sem renovação e sem cobrança recorrente.'],
      ['Atualizações incluídas', 'Novos recursos entram na sua conta sem custo extra.'],
    ],
  },
];
const included: [string, string][] = [
  ['Lançamentos ilimitados', 'Gastos e entradas à vista, parcelados e fixos.'],
  ['Cofrinhos com metas', 'Guarde dinheiro por objetivo e acompanhe o progresso.'],
  ['Cartões sob controle', 'Fatura atual, limite usado e parcelas futuras.'],
  ['Relatórios e projeção', 'Para onde vai o dinheiro e os próximos 6 meses.'],
];

export const trialText = (days: number) =>
  days > 1 ? `faltam ${days} dias` : days === 1 ? 'falta 1 dia' : 'termina hoje';
export const accessLabel = (access: Access) =>
  access.status === 'pago'
    ? `Plano ${planName[access.plan!]}`
    : access.status === 'teste'
      ? `Teste grátis · ${access.daysLeft} ${access.daysLeft === 1 ? 'dia' : 'dias'}`
      : 'Teste encerrado';

function PixelCheck() {
  return (
    <svg className="pixel-check" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      {[
        [6, 1],
        [5, 2],
        [4, 3],
        [3, 4],
        [2, 5],
        [1, 4],
        [0, 3],
      ].map(([x, y]) => (
        <rect key={x} x={x} y={y} width="1" height="1" />
      ))}
      {[
        [5, 1],
        [4, 2],
        [3, 3],
        [2, 4],
        [1, 3],
      ].map(([x, y]) => (
        <rect key={'b' + x} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  );
}

// 7×6 pixel heart with a small highlight, shown next to the lifetime plan's name.
const heartRows = ['.XX.XX.', 'XWXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
function PixelHeart() {
  return (
    <svg className="pixel-heart" viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true">
      {heartRows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c === 'W' ? '#ffd1da' : '#ff3b5c'} />
          ),
        ),
      )}
    </svg>
  );
}
function Shell({ user, children }: { user: User | null; children: ReactNode }) {
  return (
    <div className="plans-page">
      <ParticleField />
      <header className="plans-header">
        <div className="plans-header-inner">
          <a className="brand" href={href('planos')}>
            <img src="/logo.png" alt="" />
            CRAB FINANCE<span className="cursor">_</span>
          </a>
          <nav aria-label="Seções da página de planos">
            <a href={href('planos')}>Planos</a>
            <button
              type="button"
              className="nav-link"
              onClick={() => document.getElementById('recursos')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Recursos
            </button>
            <button
              type="button"
              className="nav-link"
              onClick={() => document.getElementById('perguntas')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Perguntas
            </button>
          </nav>
          <a className="pixel-button small" href={href(user ? 'dashboard' : '')}>
            {user ? 'Abrir app' : 'Entrar'}
          </a>
        </div>
      </header>
      <main className="plans-main">{children}</main>
      <footer className="plans-footer">
        <div className="plans-footer-inner">
          <span className="brand">
            <img src="/logo.png" alt="" />
            CRAB FINANCE
          </span>
          <nav aria-label="Links do rodapé">
            <a href={href('planos')}>Planos</a>
            <a href={href(user ? 'dashboard' : '')}>{user ? 'Abrir app' : 'Entrar'}</a>
            <button
              type="button"
              className="nav-link"
              onClick={() => document.getElementById('perguntas')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Ajuda
            </button>
          </nav>
          <label className="lang">
            Idioma{' '}
            <select defaultValue="pt-BR" aria-label="Idioma">
              <option value="pt-BR">Português (Brasil)</option>
            </select>
          </label>
          <p className="muted">
            © {new Date().getFullYear()} CRAB FINANCE · Desenvolvido por <strong className="pixel">Caio Agrelli</strong>
          </p>
        </div>
      </footer>
    </div>
  );
}

type Demo =
  | { kind: 'list'; rows: [string, string, string, string?][] }
  | { kind: 'bars'; rows: [string, number][] }
  | { kind: 'progress'; rows: [string, string, number, string][] }
  | { kind: 'donut'; rows: [string, number, string][] };
const features: Record<
  string,
  { title: string; text: string; points: string[]; link: string; label: string; window: string; demo: Demo }[]
> = {
  'Dia a dia': [
    {
      title: 'Registre em segundos',
      text: 'Escolha se é à vista, parcelado ou fixo. O resto o CRAB FINANCE calcula.',
      points: ['Parcelas divididas automaticamente', 'Fixos lançados todo mês'],
      link: 'gastos/novo',
      label: 'Adicionar gasto',
      window: 'gastos',
      demo: {
        kind: 'list',
        rows: [
          ['🛒', 'Mercado', '- R$ 320,50'],
          ['🚌', 'Uber', '- R$ 45,90'],
          ['💼', 'Salário', '+ R$ 6.800,00', 'pos'],
          ['📺', 'Netflix', '- R$ 55,90'],
        ],
      },
    },
    {
      title: 'Filtros que fazem sentido',
      text: 'Mês atual, últimos 30 dias, por categoria ou modalidade, com o total do período.',
      points: ['Total do período na hora', 'Previstos separados dos pagos'],
      link: 'gastos',
      label: 'Ver gastos',
      window: 'filtros',
      demo: {
        kind: 'list',
        rows: [
          ['📅', 'Mês atual', 'R$ 4.601,50'],
          ['📌', 'Fixos', 'R$ 3.406,60'],
          ['💳', 'Parcelas', 'R$ 1.194,90'],
          ['⏳', 'Previsto', 'R$ 4.111,60', 'warn'],
        ],
      },
    },
  ],
  Planejamento: [
    {
      title: 'O que vem pela frente',
      text: 'Projeção dos próximos 6 meses com fixos e parcelas já lançadas.',
      points: ['Saldo previsto mês a mês', 'Renda fixa comprometida'],
      link: 'financas',
      label: 'Ver finanças',
      window: 'projeção',
      demo: {
        kind: 'bars',
        rows: [
          ['Dez', 42],
          ['Jan', 55],
          ['Fev', 64],
          ['Mar', 76],
          ['Abr', 88],
          ['Mai', 100],
        ],
      },
    },
    {
      title: 'Cartões sem susto',
      text: 'Fatura atual, vencimento e alerta quando o limite passa de 80%.',
      points: ['Limite com parcelas futuras', 'Aviso ao estourar o limite'],
      link: 'financas',
      label: 'Ver cartões',
      window: 'cartões',
      demo: {
        kind: 'progress',
        rows: [
          ['💜', 'Nubank', 87, '#f87171'],
          ['🧡', 'Inter', 13, '#ff7a00'],
          ['🩶', 'C6', 0, '#9ca3af'],
        ],
      },
    },
  ],
  Metas: [
    {
      title: 'Cofrinhos com objetivo',
      text: 'Separe dinheiro para a viagem ou a reserva e veja o progresso até a meta.',
      points: ['Depósitos e resgates', 'Aviso quando a meta é atingida'],
      link: 'cofrinhos',
      label: 'Ver cofrinhos',
      window: 'cofrinhos',
      demo: {
        kind: 'progress',
        rows: [
          ['📱', 'Celular', 100, '#ff4fd4'],
          ['🏖️', 'Viagem', 43, '#ffb84f'],
          ['🛟', 'Reserva', 39, '#4fd4ff'],
        ],
      },
    },
  ],
  Relatórios: [
    {
      title: 'Para onde vai o dinheiro',
      text: 'Gastos por categoria, evolução de 6 meses e agrupamentos por forma de pagamento e cartão.',
      points: ['Pizza ou barras', 'Qualquer período'],
      link: 'relatorios',
      label: 'Ver relatórios',
      window: 'relatórios',
      demo: {
        kind: 'donut',
        rows: [
          ['Moradia', 59, '#ffb84f'],
          ['Educação', 12, '#a04fff'],
          ['Saúde', 10, '#4fff88'],
          ['Outros', 19, '#4fd4ff'],
        ],
      },
    },
  ],
};
function DemoView({ demo }: { demo: Demo }) {
  if (demo.kind === 'list')
    return (
      <div className="demo-list">
        {demo.rows.map(([icon, label, value, tone]) => (
          <div key={label} className={'demo-row ' + (tone ?? '')}>
            <span className="demo-icon">{icon}</span>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    );
  if (demo.kind === 'bars')
    return (
      <div className="demo-bars">
        {demo.rows.map(([label, h]) => (
          <div key={label}>
            <i style={{ height: h + '%' }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    );
  if (demo.kind === 'progress')
    return (
      <div className="demo-list">
        {demo.rows.map(([icon, label, pct, color]) => (
          <div key={label} className="demo-progress">
            <span className="demo-icon">{icon}</span>
            <div>
              <div className="demo-progress-top">
                <span>{label}</span>
                <strong>{pct}%</strong>
              </div>
              <div className="demo-track">
                <i style={{ width: pct + '%', background: color }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  const ends = demo.rows.map((_, i) => demo.rows.slice(0, i + 1).reduce((sum, [, pct]) => sum + pct, 0));
  const stops = demo.rows.map(([, pct, color], i) => `${color} ${ends[i] - pct}% ${ends[i]}%`).join(',');
  return (
    <div className="demo-donut">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }} />
      <div className="demo-legend">
        {demo.rows.map(([label, pct, color]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label} <strong>{pct}%</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
const faq: [string, string][] = [
  [
    'Como funciona o teste gratuito?',
    'Toda conta nova tem 1 mês grátis com todos os recursos. Você pode escolher um plano a qualquer momento durante o teste.',
  ],
  [
    'Qual a diferença entre os planos?',
    'Os recursos são os mesmos nos três. Muda só a forma de pagar: todo mês, uma vez por ano (parcelado em 12x) ou uma única vez para sempre.',
  ],
  [
    'Posso cancelar?',
    'No plano mensal você pode parar de pagar quando quiser. O anual vale pelo período contratado e o vitalício não tem renovação.',
  ],
  ['Quais formas de pagamento serão aceitas?', 'Pix e cartão de crédito. O anual pode ser parcelado em 12x no cartão.'],
  ['Meus dados ficam salvos se eu mudar de plano?', 'Sim. Lançamentos, cofrinhos e cadastros continuam na sua conta.'],
];

function Features() {
  const tabs = Object.keys(features);
  const [tab, setTab] = useState(tabs[0]);
  return (
    <section className="plans-section" id="recursos">
      <p className="eyebrow center">// RECURSOS</p>
      <h2 className="pixel-title">O que você ganha</h2>
      <div className="seg" role="tablist" aria-label="Categorias de recursos">
        {tabs.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'on' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        className={'feature-grid' + (features[tab].length === 1 ? ' single' : '')}
        role="tabpanel"
        aria-label={tab}
        key={tab}
      >
        {features[tab].map(f => (
          <article className="feature" key={f.title}>
            <div className="feature-copy">
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
              <ul>
                {f.points.map(p => (
                  <li key={p}>
                    <PixelCheck />
                    {p}
                  </li>
                ))}
              </ul>
              <a className="text-link" href={href(f.link)}>
                {f.label} →
              </a>
            </div>
            <div className="window" aria-hidden="true">
              <div className="window-bar">
                <i />
                <i />
                <i />
                <span>crab finance — {f.window}</span>
              </div>
              <DemoView demo={f.demo} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const yes = <PixelCheck />;
const compare: [string, ReactNode, ReactNode, ReactNode][] = [
  ['Preço', brl(MONTHLY) + '/mês', '12x ' + brl(ANNUAL_INSTALLMENT), brl(LIFETIME)],
  ['Por mês', brl(MONTHLY), brl(ANNUAL_INSTALLMENT), 'Paga só uma vez'],
  ['Economia', '—', `${annualSavings}% vs. mensal`, `Se paga em ${lifetimeBreakEven} meses`],
  ['Cobrança', 'Todo mês', 'Anual, em até 12x', 'Única'],
  ['Renovação', 'Mensal', 'A cada 12 meses', 'Nunca'],
  ['Todos os recursos', yes, yes, yes],
  ['Atualizações futuras', yes, yes, yes],
];

function Compare() {
  return (
    <section className="plans-section">
      <p className="eyebrow center">// COMPARAR</p>
      <h2 className="pixel-title">Compare os planos</h2>
      <div className="compare-wrap" tabIndex={0} role="region" aria-label="Comparação dos planos">
        <table className="compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Item</span>
              </th>
              {plans.map(p => (
                <th scope="col" key={p.id} className={p.badge ? 'featured' : ''}>
                  {p.badge && <span className="mini-badge">{p.badge}</span>}
                  {p.name}
                  {p.id === 'vitalicio' && <PixelHeart />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compare.map(([label, ...cells]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {cells.map((c, i) => (
                  <td key={i} className={plans[i].badge ? 'featured' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {plans.map(p => (
                <td key={p.id} className={p.badge ? 'featured' : ''}>
                  <a
                    className={'pixel-button small' + (p.badge ? '' : ' ghost')}
                    href={href('planos/checkout', { plano: p.id })}
                  >
                    Assinar
                  </a>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export function PlansPage({ user }: { user: User | null }) {
  return (
    <Shell user={user}>
      <section className="plans-hero">
        {user?.access?.status === 'expirado' && (
          <div className="trial-box expired" role="alert">
            <span className="trial-dot" />
            Seu teste gratuito terminou. Escolha um plano para continuar usando o CRAB FINANCE.
          </div>
        )}
        {user?.access?.status === 'pago' && (
          <div className="trial-box" role="status">
            <span className="trial-dot" />
            Você está no <strong>{accessLabel(user.access)}</strong>
            {user.access.planExpiresAt
              ? ` · válido até ${displayDate(user.access.planExpiresAt.slice(0, 10))}`
              : ' · acesso para sempre'}
            .
          </div>
        )}
        <h1 className="pixel-title big">Escolha o plano ideal para você</h1>
        <div className="crab-lane">
          <PixelCrab />
        </div>
      </section>
      <section className="plan-grid" aria-label="Planos">
        {plans.map(p => (
          <article key={p.id} className={'plan-card' + (p.badge ? ' featured' : '')}>
            {p.badge && <span className="plan-badge">{p.badge}</span>}
            <h2 className="pixel-title">
              {p.name}
              {p.id === 'vitalicio' && <PixelHeart />}
            </h2>
            <p className="muted">{p.tagline}</p>
            <p className="plan-price">
              <strong>{p.price}</strong>
              {p.period && <span>{p.period}</span>}
            </p>
            <p className="plan-note">{p.note}</p>
            <a className={'pixel-button' + (p.badge ? '' : ' ghost')} href={href('planos/checkout', { plano: p.id })}>
              {p.cta}
            </a>
            <p className="plan-includes">Inclui:</p>
            <ul className="plan-list">
              {p.extras.map(([a, b]) => (
                <li key={a}>
                  <PixelCheck />
                  <div>
                    <strong>{a}</strong>
                    <span>{b}</span>
                  </div>
                </li>
              ))}
            </ul>
            <hr />
            <ul className="plan-list">
              {included.map(([a, b]) => (
                <li key={a}>
                  <PixelCheck />
                  <div>
                    <strong>{a}</strong>
                    <span>{b}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <Features />
      <Compare />
      <section className="plans-section" id="perguntas">
        <p className="eyebrow center">// AJUDA</p>
        <h2 className="pixel-title">Perguntas frequentes</h2>
        <div className="faq">
          {faq.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
      {/* After the trial only this page is reachable, so the account can also be deleted from here (LGPD). */}
      {user?.access?.status === 'expirado' && !user.isAdmin && (
        <details className="plans-delete">
          <summary>Não quer continuar? Excluir minha conta</summary>
          <DeleteAccount user={user} />
        </details>
      )}
    </Shell>
  );
}

export function CheckoutPage({
  user,
  planId,
  onAccess,
}: {
  user: User | null;
  planId: string | null;
  onAccess: (access: Access) => void;
}) {
  const plan = plans.find(p => p.id === planId) ?? plans[1];
  const [email, setEmail] = useState(user?.email ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const access = user?.access;
  async function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/billing/checkout', 'POST', {
        plan: plan.id,
        ...(user?.email ? {} : { email }),
      });
      location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o pagamento.');
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm('Cancelar a assinatura mensal? Você continua com acesso até o fim do período já pago.')) return;
    setBusy(true);
    setError('');
    try {
      onAccess(await api<Access>('/billing/cancel', 'POST'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell user={user}>
      <section className="checkout">
        <a className="back-link" href={href('planos')}>
          ← Planos
        </a>
        <h1 className="pixel-title">Pagamento</h1>
        <div className="checkout-grid">
          <div className="checkout-card">
            {!user ? (
              <>
                <p className="eyebrow">// ENTRE PARA ASSINAR</p>
                <p className="muted">
                  Para assinar, entre na sua conta ou crie uma. Toda conta nova começa com 1 mês grátis.
                </p>
                <a className="pixel-button wide" href={href('')}>
                  Entrar
                </a>
              </>
            ) : access?.plan === 'vitalicio' ? (
              <>
                <p className="eyebrow">// TUDO CERTO</p>
                <p>
                  Sua conta já tem o <strong>plano Vitalício</strong>. Não há mais nada para pagar.
                </p>
                <a className="pixel-button wide" href={href('dashboard')}>
                  Abrir app
                </a>
              </>
            ) : (
              <form onSubmit={pay}>
                <p className="eyebrow">// FORMA DE PAGAMENTO</p>
                <p className="muted">
                  {plan.id === 'mensal'
                    ? 'A assinatura mensal é cobrada automaticamente no cartão de crédito, todo mês.'
                    : 'Você escolhe Pix ou cartão de crédito (em até 12x) na página segura do Mercado Pago.'}
                </p>
                {user.email ? (
                  <p className="receipt-email">
                    Recibo enviado para <strong>{user.email}</strong>, o e-mail da sua conta.
                  </p>
                ) : (
                  <label className="checkout-field">
                    E-mail da conta
                    <input
                      type="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="voce@exemplo.com"
                      autoComplete="email"
                    />
                    <small>Fica salvo na sua conta e recebe os recibos.</small>
                  </label>
                )}
                {access?.status === 'pago' && (
                  <p className="checkout-note">
                    Você já tem o {accessLabel(access)}
                    {access.planExpiresAt ? `, válido até ${displayDate(access.planExpiresAt.slice(0, 10))}` : ''}.{' '}
                    {plan.id === 'vitalicio'
                      ? 'O vitalício substitui o plano atual.'
                      : 'O novo período começa quando o atual terminar.'}
                  </p>
                )}
                {error && (
                  <p className="checkout-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="pixel-button wide" disabled={busy}>
                  {busy ? 'Abrindo o Mercado Pago…' : `Pagar ${brl(plan.total)}`}
                </button>
                <p className="secure muted">
                  🔒 Pagamento processado pelo Mercado Pago. O CRAB FINANCE não vê os dados do seu cartão.
                </p>
                {access?.canCancel && (
                  <button type="button" className="nav-link danger-link" onClick={cancel} disabled={busy}>
                    Cancelar assinatura mensal
                  </button>
                )}
              </form>
            )}
          </div>
          <aside className="checkout-card summary-card">
            <p className="eyebrow">// RESUMO</p>
            <h2 className="pixel-title">
              Plano {plan.name}
              {plan.id === 'vitalicio' && <PixelHeart />}
            </h2>
            <p className="muted">{plan.tagline}</p>
            <div className="sum-row">
              <span>Cobrança</span>
              <strong>{plan.charge}</strong>
            </div>
            <div className="sum-row">
              <span>Total</span>
              <strong className="pixel">{brl(plan.total)}</strong>
            </div>
            {access?.status === 'teste' && (
              <p className="muted small">
                Seu teste gratuito vai até {displayDate(access.trialEndsAt.slice(0, 10))} ({trialText(access.daysLeft)}
                ).
              </p>
            )}
            <div className="plan-switch">
              {plans
                .filter(p => p.id !== plan.id)
                .map(p => (
                  <a key={p.id} href={href('planos/checkout', { plano: p.id })}>
                    Trocar para {p.name}
                  </a>
                ))}
            </div>
          </aside>
        </div>
      </section>
    </Shell>
  );
}

const results: Record<string, [string, string]> = {
  aprovado: ['Pagamento aprovado!', 'Seu plano já está ativo. Obrigado por apoiar o CRAB FINANCE.'],
  pendente: [
    'Pagamento em processamento',
    'Assim que o Mercado Pago confirmar (no Pix pode levar alguns minutos), seu plano é ativado automaticamente.',
  ],
  recusado: ['Pagamento não aprovado', 'Nada foi cobrado. Você pode tentar de novo com outra forma de pagamento.'],
  erro: [
    'Não encontramos esse pagamento',
    'Se você concluiu o pagamento, ele será confirmado automaticamente. Em caso de dúvida, tente de novo.',
  ],
};
export function ResultPage({
  user,
  status,
  planId,
}: {
  user: User | null;
  status: string | null;
  planId: string | null;
}) {
  const [title, text] = results[status ?? ''] ?? results.erro;
  const plan = plans.find(p => p.id === planId);
  return (
    <Shell user={user}>
      <section className="checkout result">
        <h1 className="pixel-title">{title}</h1>
        {plan && (
          <p className="pixel small-pixel">
            Plano {plan.name}
            {plan.id === 'vitalicio' && <PixelHeart />}
          </p>
        )}
        <p className="muted">{text}</p>
        <div className="result-actions">
          {status === 'aprovado' ? (
            <a className="pixel-button" href={href('dashboard')}>
              Abrir app
            </a>
          ) : (
            <a className="pixel-button" href={href('planos/checkout', planId ? { plano: planId } : undefined)}>
              Tentar de novo
            </a>
          )}
          <a className="pixel-button ghost" href={href('planos')}>
            Ver planos
          </a>
        </div>
        <div className="crab-lane">
          <PixelCrab />
        </div>
      </section>
    </Shell>
  );
}
