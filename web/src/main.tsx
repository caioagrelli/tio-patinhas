import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { Auth } from './login';
import type { Catalog, Dashboard, User } from './types';
import { planName } from '../../shared/plans';
import { App, parseRoute, href, useData, useApp, type Flash, type Route } from './ui';
import { DashboardPage } from './pages/dashboard';
import { TransactionDelete, TransactionForm, TransactionList } from './pages/transactions';
import { BoxDelete, BoxForm, BoxList, BoxMovement } from './pages/boxes';
import { FinancePage, PlanDelete, PlanForm, RecurrenceDelete, RecurrenceForm } from './pages/finance';
import { ReportsPage } from './pages/reports';
import { SettingsDelete, SettingsForm, SettingsPage } from './pages/settings';
import { AdminPage, AdminUser } from './pages/admin';
import { CrabAiPage } from './pages/crab-ai';
import { accessLabel, CheckoutPage, PlansPage, ResultPage, trialText } from './pages/plans';
import './style.css';

// Same menu as the Django app; "Configurações" is the gear button.
const menu: [string, string, string[], string][] = [
  ['dashboard', 'Dashboard', ['', 'dashboard'], 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  ['gastos', 'Gastos', ['gastos'], 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16V8M8.5 11.5 12 8l3.5 3.5'],
  ['entradas', 'Entradas', ['entradas'], 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8.5 12.5 12 16l3.5-3.5'],
  ['financas', 'Finanças', ['financas'], 'M3 3v18h18M7 15l4-4 3 3 6-7'],
  [
    'cofrinhos',
    'Cofrinhos',
    ['cofrinhos'],
    'M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 7l2-3h10l2 3M15.5 13.5h.01',
  ],
  ['relatorios', 'Relatórios', ['relatorios'], 'M5 20V11M12 20V5M19 20v-6M3 20h18'],
];
// Hashes used before the pages mirrored the Django URLs.
const legacy: Record<string, string> = {
  expenses: 'gastos',
  incomes: 'entradas',
  boxes: 'cofrinhos',
  finance: 'financas',
  reports: 'relatorios',
  settings: 'configuracoes',
};

// Sun shows in the dark theme (switch to light), moon in the light theme; CSS cross-fades them.
function ThemeIcon() {
  return (
    <span className="theme-icon" aria-hidden="true">
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
          <line key={a} x1="12" y1="2.6" x2="12" y2="4.8" transform={`rotate(${a} 12 12)`} />
        ))}
      </svg>
      <svg className="moon" viewBox="0 0 24 24">
        <path fill="currentColor" d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z" />
      </svg>
    </span>
  );
}

function Page({ route }: { route: Route }) {
  const { user } = useApp();
  const [section, a, b, c] = route.path;
  switch (section ?? 'dashboard') {
    case 'dashboard':
      return <DashboardPage />;
    case 'gastos':
    case 'entradas': {
      const type = section === 'gastos' ? 'expense' : 'income';
      if (!a) return <TransactionList type={type} />;
      if (a === 'novo' || a === 'nova') return <TransactionForm type={type} />;
      if (b === 'editar') return <TransactionForm type={type} id={a} />;
      break;
    }
    case 'lancamentos':
      if (b === 'excluir') return <TransactionDelete id={a} />;
      break;
    case 'cofrinhos':
      if (!a) return <BoxList />;
      if (a === 'novo') return <BoxForm />;
      if (b === 'editar') return <BoxForm id={a} />;
      if (b === 'excluir') return <BoxDelete id={a} />;
      if (b === 'depositar' || b === 'resgatar')
        return <BoxMovement id={a} action={b === 'depositar' ? 'deposit' : 'withdraw'} />;
      break;
    case 'financas':
      if (!a) return <FinancePage />;
      if (a === 'fixos' && c === 'editar') return <RecurrenceForm id={b} />;
      if (a === 'fixos' && c === 'excluir') return <RecurrenceDelete id={b} />;
      if (a === 'parcelamentos' && c === 'editar') return <PlanForm id={b} />;
      if (a === 'parcelamentos' && c === 'excluir') return <PlanDelete id={b} />;
      break;
    case 'configuracoes':
      if (!b) return <SettingsPage tab={a ?? 'aparencia'} />;
      if (b === 'novo') return <SettingsForm tab={a} />;
      if (c === 'editar') return <SettingsForm tab={a} id={b} />;
      if (c === 'excluir') return <SettingsDelete tab={a} id={b} />;
      break;
    case 'relatorios':
      return <ReportsPage />;
    case 'crab-ai':
      return <CrabAiPage />;
    case 'admin':
      if (!user.isAdmin) break;
      if (!a) return <AdminPage />;
      if (a === 'usuarios' && b) return <AdminUser id={b} />;
      break;
  }
  return (
    <div className="empty panel">
      <p>Página não encontrada.</p>
      <a className="button" href={href('dashboard')}>
        Ir para o Dashboard
      </a>
    </div>
  );
}

/** Top banner when a savings box reached its goal (Django's alerta_topo). */
function GoalBanner() {
  const { route } = useApp();
  const { data } = useData<Dashboard>('/dashboard', route);
  const [hidden, setHidden] = useState<string[]>([]);
  const box = data?.alerts.find(b => !hidden.includes(b.id));
  if (!box) return null;
  return (
    <div className="goal-banner" role="status">
      <span>🎉 Meta do cofrinho "{box.name}" atingida!</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Fechar aviso"
        onClick={() => {
          setHidden(h => [...h, box.id]);
          void api(`/boxes/${box.id}/dismiss`, 'POST').catch(() => {});
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Root() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  );
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [flash, setFlash] = useState<Flash[]>([]),
    keepFlash = useRef(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    const controller = new AbortController();
    api<User>('/auth/me', 'GET', undefined, controller.signal)
      .then(setUser)
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const first = route.path[0];
    if (first && legacy[first]) location.replace(href(legacy[first]));
    const listener = () => {
      setRoute(parseRoute());
      if (!keepFlash.current) setFlash([]);
      keepFlash.current = false;
      scrollTo(0, 0);
    };
    addEventListener('hashchange', listener);
    return () => removeEventListener('hashchange', listener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    api<Catalog>('/catalog')
      .then(setCatalog)
      .catch(() => {});
  }, [user, catalogVersion]);
  const unauthorized = useCallback(() => {
    setUser(null);
    setCatalog(null);
  }, []);
  const go = useCallback((path: string, messages: Flash[] = []) => {
    setFlash(messages);
    const target = '#/' + path.replace(/^#?\/?/, '');
    if (location.hash === target) {
      setRoute(parseRoute(target));
      scrollTo(0, 0);
    } else {
      keepFlash.current = true;
      location.hash = target;
    }
  }, []);
  const reloadCatalog = useCallback(() => setCatalogVersion(v => v + 1), []);
  // Keep the current page visible in the header menu when it scrolls sideways (small screens).
  useEffect(() => {
    document.querySelector('header nav [aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route, user]);
  async function logout() {
    try {
      await api('/auth/logout', 'POST');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    setUser(null);
    setCatalog(null);
    setFlash([]);
  }
  if (checking)
    return (
      <main className="loading" role="status">
        Abrindo sua carteira…
      </main>
    );
  // The plans and checkout pages are public and have their own layout.
  if (route.path[0] === 'planos')
    return route.path[1] === 'checkout' ? (
      <CheckoutPage
        user={user}
        planId={route.query.get('plano')}
        onAccess={access => setUser(u => u && { ...u, access })}
      />
    ) : route.path[1] === 'resultado' ? (
      <ResultPage user={user} status={route.query.get('status')} planId={route.query.get('plano')} />
    ) : (
      <PlansPage user={user} />
    );
  if (!user)
    return (
      <Auth
        onLogin={() => {
          setFlash([]);
          void api<User>('/auth/me').then(setUser);
        }}
      />
    );
  // Trial over and no paid plan: only the plans page is available.
  if (user.access?.status === 'expirado' && !user.isAdmin) return <PlansPage user={user} />;
  const access = user.access;
  const section = route.path[0] ?? '';
  const context = {
    user,
    route,
    catalog,
    go,
    reloadCatalog,
    unauthorized,
    theme,
    setTheme,
    logout: () => void logout(),
  };
  return (
    <App.Provider value={context}>
      <GoalBanner />
      <header>
        <div className="header-inner">
          <a className="brand" href={href('dashboard')}>
            <img src="/logo.png" alt="" />
            CRAB FINANCE<span>.</span>
          </a>
          <nav aria-label="Navegação principal">
            {menu.map(([key, label, sections, icon]) => (
              <a key={key} href={href(key)} aria-current={sections.includes(section) ? 'page' : undefined}>
                <svg
                  className="nav-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={icon} />
                </svg>
                <span>{label}</span>
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <span className="muted hello" title={user.name}>
              Olá, {user.name}
            </span>
            <button
              className="secondary theme-toggle"
              aria-label="Alternar tema"
              title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            >
              <ThemeIcon />
            </button>
            {user.isAdmin && (
              <a
                className={'icon-link' + (section === 'admin' ? ' active' : '')}
                href={href('admin')}
                title="Painel do admin"
                aria-label="Painel do admin"
                aria-current={section === 'admin' ? 'page' : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </a>
            )}
            <a
              className={'icon-link' + (section === 'configuracoes' ? ' active' : '')}
              href={href('configuracoes')}
              title="Configurações"
              aria-label="Configurações"
              aria-current={section === 'configuracoes' ? 'page' : undefined}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
            <button className="secondary" onClick={logout}>
              Sair
            </button>
            {access && (
              <a
                className={'trial-pill' + (access.status === 'pago' ? ' paid' : '')}
                href={href('planos')}
                title={access.status === 'teste' ? `Teste gratuito: ${trialText(access.daysLeft)}` : 'Seu plano'}
              >
                <span className="trial-dot" />
                <span className="pill-long">{accessLabel(access)}</span>
                <span className="pill-short">
                  {access.status === 'teste'
                    ? `${access.daysLeft} ${access.daysLeft === 1 ? 'dia' : 'dias'}`
                    : access.status === 'pago' && access.plan
                      ? planName[access.plan]
                      : 'Expirado'}
                </span>
              </a>
            )}
          </div>
        </div>
      </header>
      {section === 'crab-ai' ? (
        <main className="ai-shell">
          <CrabAiPage />
        </main>
      ) : (
        <main className="container">
          {flash.length > 0 && (
            <div className="flash-list">
              {flash.map((m, i) => (
                <div key={i} className={'flash ' + m.kind} role={m.kind === 'success' ? 'status' : 'alert'}>
                  {m.text}
                </div>
              ))}
            </div>
          )}
          <Page key={route.path.join('/') + '?' + route.query} route={route} />
        </main>
      )}
      {section !== 'crab-ai' && (
        <a className="crab-ai-fab" href={href('crab-ai')} aria-label="Abrir o Crab AI">
          <img src="/logo.png" alt="" />
          <span>Crab AI</span>
        </a>
      )}
      {section !== 'crab-ai' && (
        <footer>
          <span className="brand">
            <img src="/logo.png" alt="" />
            CRAB FINANCE<span>.</span>
          </span>
          <div className="footer-text">
            <span>
              © {new Date().getFullYear()} CRAB FINANCE — controle financeiro pessoal. Todos os dados ficam só com você.
            </span>
            <span className="footer-credit">
              Desenvolvido por <strong>Caio Agrelli</strong>
            </span>
          </div>
        </footer>
      )}
    </App.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
