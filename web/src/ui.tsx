import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, brl } from './api';
import type { Catalog, Named, User } from './types';

// Hash routes mirror the Django URLs: #/gastos, #/gastos/novo, #/cofrinhos/3/depositar...
export type Route = { path: string[]; query: URLSearchParams };
export function parseRoute(hash = location.hash): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}
export const href = (path: string, query?: Record<string, string | undefined>) => {
  const params = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => !!e[1]));
  return '#/' + path.replace(/^\//, '') + (params.size ? '?' + params : '');
};

export type FlashKind = 'success' | 'warning' | 'error';
export type Flash = { kind: FlashKind; text: string };
type AppContext = {
  user: User;
  route: Route;
  catalog: Catalog | null;
  /** Navigates and shows the messages on the next page, like Django's messages framework. */
  go: (path: string, flash?: Flash[]) => void;
  reloadCatalog: () => void;
  unauthorized: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  logout: () => void;
};
export const App = createContext<AppContext>(null!);
export const useApp = () => useContext(App);

/** Loads an API path, reloading when `key` changes; a 401 sends the user back to the login. */
export function useData<T>(path: string | null, key: unknown = path) {
  const { unauthorized } = useApp();
  const [state, setState] = useState<{ data: T | null; error: string }>({ data: null, error: '' });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, 'GET', undefined, controller.signal)
      .then(data => setState({ data, error: '' }))
      .catch(err => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) unauthorized();
        else if (err instanceof ApiError && err.status === 402) location.hash = '#/planos';
        else setState({ data: null, error: err instanceof Error ? err.message : 'Não foi possível carregar.' });
      });
    return () => controller.abort();
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Back({ to, label }: { to: string; label: string }) {
  return (
    <a className="back-link" href={href(to)}>
      ← {label}
    </a>
  );
}
export function Loading({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : (
    <p className="muted" role="status">
      Carregando…
    </p>
  );
}
export function Field({
  label,
  help,
  aside,
  error,
  children,
  id,
}: {
  label: ReactNode;
  help?: ReactNode;
  aside?: ReactNode;
  error?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="field" id={id}>
      {aside && <span className="field-aside">{aside}</span>}
      <label>
        <span>{label}</span>
        {children}
      </label>
      {help && <small className="muted">{help}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
export function MoneyInput({
  name = 'value',
  value,
  required = true,
  onInput,
}: {
  name?: string;
  value?: number | null;
  required?: boolean;
  onInput?: (v: string) => void;
}) {
  return (
    <input
      name={name}
      type="number"
      inputMode="decimal"
      min="0.01"
      max="9999999999.99"
      step="0.01"
      required={required}
      defaultValue={value == null ? '' : (value / 100).toFixed(2)}
      placeholder="0,00"
      onInput={e => onInput?.(e.currentTarget.value)}
    />
  );
}
export function Choose({
  name,
  rows,
  value,
  empty,
  required,
  onChange,
}: {
  name: string;
  rows: Named[];
  value?: string | null;
  empty: string;
  required?: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <select name={name} defaultValue={value ?? ''} required={required} onChange={e => onChange?.(e.target.value)}>
      <option value="">{empty}</option>
      {rows.map(r => (
        <option key={r.id} value={r.id}>
          {r.icon ? r.icon + ' ' : ''}
          {r.name}
        </option>
      ))}
    </select>
  );
}
export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar-track">
      <div style={{ width: Math.max(0, Math.min(100, value)) + '%', background: color || 'var(--accent)' }} />
    </div>
  );
}
export function Money({ cents, sign }: { cents: number; sign?: boolean }) {
  return (
    <>
      {sign && cents > 0 ? '+' : ''}
      {brl(cents)}
    </>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty panel">{children}</div>;
}

/** Confirmation page used by every "Excluir" link, like Django's confirm_delete.html. */
export function ConfirmDelete({
  title,
  name,
  detail,
  cancel,
  onConfirm,
  children,
}: {
  title: string;
  name?: string;
  detail: ReactNode;
  cancel: string;
  onConfirm: (form: FormData) => Promise<void>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="form-page">
      <h1>{title}?</h1>
      {name && <p className="confirm-name">"{name}"</p>}
      <p className="muted">{detail} Essa ação não pode ser desfeita.</p>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onConfirm(new FormData(e.currentTarget));
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {children}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions start">
          <button className="destructive" disabled={busy}>
            {busy ? 'Excluindo…' : 'Sim, excluir'}
          </button>
          <a className="button secondary" href={href(cancel)}>
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}

/** Grouped totals with a percentage bar (Django's partials/breakdown.html). */
export function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { name: string; icon?: string; color: string; value: number; count?: number; percent: number }[];
  empty: string;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length ? (
        rows.map(r => (
          <div className="category-report" key={r.name}>
            <div>
              <span>
                {r.icon ? r.icon + ' ' : ''}
                {r.name}
                {r.count ? <small className="muted"> · {r.count} lanç.</small> : null}
              </span>
              <span>
                <strong>{brl(r.value)}</strong> <small className="muted">{pct(r.percent)}</small>
              </span>
            </div>
            <Progress value={r.percent} color={r.color} />
          </div>
        ))
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}

export const monthLabel = (date: string, year: 'short' | 'long' = 'short') => {
  const d = new Date(date.slice(0, 7) + '-15T12:00:00Z');
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  return `${month[0].toUpperCase()}${month.slice(1)}/${year === 'short' ? date.slice(2, 4) : date.slice(0, 4)}`;
};
export const pct = (value: number | null | undefined) => String(value ?? 0).replace('.', ',') + '%';
export const shortDate = (date: string) => date.slice(8, 10) + '/' + date.slice(5, 7);
export const installmentLabel = (t: {
  installmentNumber: number | null;
  plan?: { installments: number } | null;
  installments?: number | null;
}) => (t.installmentNumber ? `${t.installmentNumber}/${t.plan?.installments ?? t.installments}` : '');
