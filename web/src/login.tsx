import '@fontsource/press-start-2p/latin-400.css';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ParticleField } from './particles';
import { crabColors, crabSprite } from './crab-sprite';
import { api } from './api';
import type { User } from './types';

const text = (f: FormData, key: string) => String(f.get(key) ?? '');
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

type TurnstileApi = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
let turnstileScript: Promise<TurnstileApi> | null = null;
function loadTurnstile() {
  return (turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => resolve((window as unknown as { turnstile: TurnstileApi }).turnstile);
    script.onerror = () => {
      turnstileScript = null;
      script.remove();
      reject(new Error('Não foi possível carregar a verificação de segurança.'));
    };
    document.head.append(script);
  }));
}
// Walking crab for the login page: the sprite with alternate pairs of legs lifted one pixel.
const crabLegs = [
  [
    [6, 9],
    [33, 39],
  ],
  [
    [12, 16],
    [40, 44],
  ],
]; // column ranges of each leg pair, below the shell (rows 27+)
function liftLegs(groups: number[][]) {
  const rows = crabSprite.map(r => [...r]);
  for (const [from, to] of groups)
    for (let y = 27; y < rows.length; y++)
      for (let x = from; x <= to; x++) {
        rows[y - 1][x] = rows[y][x];
        if (y === rows.length - 1) rows[y][x] = '.';
      }
  return rows.flatMap((row, y) =>
    [...row.join('').matchAll(/#+|o+|d+|w+/g)].map(m => (
      <rect key={`${y}-${m.index}`} x={m.index} y={y} width={m[0].length} height={1} fill={crabColors[m[0][0]]} />
    )),
  );
}
const credit = 'Developed by Caio Agrelli';
/** Signature on the crab's path: walking right the crab writes it letter by letter, walking back it erases it. */
function CrabCredit() {
  const box = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const letters = [...box.current!.querySelectorAll<HTMLSpanElement>('span')];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      letters.forEach(l => l.classList.add('shown'));
      return;
    }
    let frame = 0,
      previous: number | null = null;
    const tick = () => {
      const crab = document.querySelector('.crab-walker')?.getBoundingClientRect();
      if (crab) {
        const center = crab.left + crab.width / 2;
        if (previous !== null && center !== previous) {
          const writing = center > previous;
          for (const letter of letters) {
            const r = letter.getBoundingClientRect();
            if (Math.abs(center - (r.left + r.width / 2)) < crab.width * 0.3) letter.classList.toggle('shown', writing);
          }
        }
        previous = center;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <p className="crab-credit" ref={box} aria-label={credit}>
      {[...credit].map((c, i) => (
        <span key={i} aria-hidden="true">
          {c === ' ' ? '\u00a0' : c}
        </span>
      ))}
    </p>
  );
}
export function PixelCrab({ children }: { children?: ReactNode } = {}) {
  return (
    <div className="crab-walker" aria-hidden="true">
      {children}
      <svg viewBox={`0 0 ${crabSprite[0].length} ${crabSprite.length}`} shapeRendering="crispEdges">
        <g className="crab-frame">{liftLegs(crabLegs[0])}</g>
        <g className="crab-frame">{liftLegs(crabLegs[1])}</g>
      </svg>
    </div>
  );
}
const loginErrors: Record<string, string> = {
  captcha: 'Confirme a verificação de segurança e tente de novo.',
  cancelado: 'Login com Google cancelado.',
  sessao: 'A tentativa de login expirou. Tente de novo.',
  google: 'Não foi possível confirmar sua conta Google. Tente de novo.',
  email: 'Sua conta Google precisa ter o e-mail verificado.',
  inativo: 'Esta conta está desativada.',
  indisponivel: 'O login com Google não está configurado neste servidor.',
};
export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState(() => loginErrors[new URLSearchParams(location.search).get('erro') ?? ''] ?? '');
  const [deleted] = useState(() => new URLSearchParams(location.search).get('conta') === 'excluida');
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ google: boolean; turnstileSiteKey: string | null } | null>(null),
    [captcha, setCaptcha] = useState('');
  const widget = useRef<HTMLDivElement>(null),
    widgetId = useRef<string | null>(null),
    turnstile = useRef<TurnstileApi | null>(null);
  const siteKey = config?.turnstileSiteKey;
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  }, []);
  useEffect(() => {
    api<{ google: boolean; turnstileSiteKey: string | null }>('/auth/config')
      .then(setConfig)
      .catch(() => setError('Não foi possível carregar o login. Recarregue a página.'));
  }, []);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then(ts => {
        if (cancelled || !widget.current) return;
        turnstile.current = ts;
        widgetId.current = ts.render(widget.current, {
          sitekey: siteKey,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          language: 'pt-br',
          size: 'flexible',
          callback: (token: string) => setCaptcha(token),
          'expired-callback': () => setCaptcha(''),
          'error-callback': () => setCaptcha(''),
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      if (widgetId.current) turnstile.current?.remove(widgetId.current);
      widgetId.current = null;
      setCaptcha('');
    };
  }, [siteKey]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (siteKey && !captcha) {
      setError('Confirme a verificação de segurança.');
      return;
    }
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      onLogin(
        await api<User>(
          '/auth/' + (register ? 'register' : 'login'),
          'POST',
          {
            username: text(f, 'username'),
            password: text(f, 'password'),
            ...(register ? { name: text(f, 'name'), email: text(f, 'email') } : {}),
          },
          undefined,
          captcha ? { 'X-Turnstile-Token': captcha } : {},
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar.');
      // Each Turnstile token is single-use, so a failed attempt needs a fresh challenge.
      if (widgetId.current) {
        turnstile.current?.reset(widgetId.current);
        setCaptcha('');
      }
      setBusy(false);
    }
  }
  function google() {
    if (siteKey && !captcha) {
      setError('Confirme a verificação de segurança.');
      return;
    }
    setBusy(true);
    location.assign('/api/auth/google' + (captcha ? '?captcha=' + encodeURIComponent(captcha) : ''));
  }
  const waiting = busy || (!!siteKey && !captcha);
  return (
    <div className={'auth-page' + (register ? ' registering' : '')}>
      <ParticleField />
      <main className="auth-shell">
        <section className="auth-intro">
          <a className="brand" href="#">
            <img src="/logo.png" alt="" />
            CRAB FINANCE<span className="cursor">_</span>
          </a>
          <figure className="auth-quote">
            <blockquote>
              <h1>
                “Palavra de cinco letras para felicidade… <em>DINHEIRO!</em>”
              </h1>
            </blockquote>
            <figcaption>— Seu Sirigueijo</figcaption>
          </figure>
          <p>Organize suas contas, acompanhe seus planos e dê um propósito a cada centavo.</p>
          <a className="plans-link" href="#/planos">
            Ver planos →
          </a>
        </section>
        <section className="auth-card">
          <p className="eyebrow">BEM-VINDO AO SEU CONTROLE FINANCEIRO</p>
          <h2>{register ? 'Crie sua conta' : 'Bom te ver por aqui\u00a0 ;)'}</h2>
          {register && <p className="muted">Comece a cuidar dos seus próximos planos.</p>}
          <form onSubmit={submit} className="form-grid">
            {register && (
              <Field label="Seu nome">
                <input name="name" required maxLength={80} autoComplete="name" />
              </Field>
            )}
            {register && (
              <Field label="E-mail">
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  placeholder="voce@exemplo.com"
                />
              </Field>
            )}
            <Field label="Usuário">
              <input
                name="username"
                required
                minLength={3}
                maxLength={60}
                autoComplete="username"
                autoCapitalize="none"
              />
            </Field>
            <Field label="Senha">
              <input
                name="password"
                type="password"
                required
                minLength={register ? 10 : 1}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
            </Field>
            {register && <small className="muted">Use pelo menos 10 caracteres.</small>}
            {siteKey && <div ref={widget} />}
            {deleted && !error && (
              <p className="notice" role="status">
                Sua conta e seus dados foram excluídos.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button disabled={waiting}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
            {config?.google && (
              <>
                <div className="divider">
                  <span>ou</span>
                </div>
                <button type="button" className="google" onClick={google} disabled={waiting}>
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
                    />
                  </svg>
                  Continuar com Google
                </button>
              </>
            )}
          </form>
          <p className="auth-switch">
            {register ? 'Já tem uma conta?' : 'Primeira vez por aqui?'}{' '}
            <button
              className="link"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Entrar na conta' : 'Criar uma conta'}
            </button>
          </p>
        </section>
      </main>
      <CrabCredit />
      <PixelCrab />
    </div>
  );
}
