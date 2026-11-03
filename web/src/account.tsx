import { useState, type FormEvent } from 'react';
import { api } from './api';
import { Field } from './ui';
import type { User } from './types';

/** LGPD: anyone can erase their account. Asks for the password (or, for Google-only accounts, just the typed confirmation). */
export function DeleteAccount({ user }: { user: User }) {
  const [confirmation, setConfirmation] = useState(''),
    [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const ready = confirmation.trim().toUpperCase() === 'EXCLUIR' && (!user.hasPassword || password.length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/account', 'DELETE', { confirmation, ...(user.hasPassword ? { password } : {}) });
      // The session cookie is gone; a full reload shows the login page with the confirmation message.
      location.assign('/?conta=excluida');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="danger-zone" onSubmit={submit}>
      <h2>Excluir conta</h2>
      <p className="muted">
        Apaga para sempre seus lançamentos, cartões, cofrinhos, conversas com o Crab AI e o seu login. Uma assinatura
        mensal ativa é cancelada no Mercado Pago. Isso não pode ser desfeito.
      </p>
      {user.isAdmin ? (
        <p className="muted small">Contas de administrador não podem ser excluídas por aqui.</p>
      ) : (
        <>
          {user.hasPassword && (
            <Field label="Sua senha">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </Field>
          )}
          <Field label="Digite EXCLUIR para confirmar">
            <input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="destructive" disabled={!ready || busy}>
            {busy ? 'Excluindo…' : 'Excluir minha conta'}
          </button>
        </>
      )}
    </form>
  );
}

/** Change the password (or create one, for accounts that only used Google). Other sessions are closed. */
export function ChangePassword({ user }: { user: User }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '');
    if (value('password') !== value('confirm')) {
      setMessage({ ok: false, text: 'As duas senhas novas não são iguais.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api('/auth/password', 'POST', {
        ...(user.hasPassword ? { current: value('current') } : {}),
        password: value('password'),
      });
      form.reset();
      setMessage({
        ok: true,
        text: user.hasPassword
          ? 'Senha alterada. As outras sessões foram encerradas.'
          : 'Senha criada. Agora você também pode entrar com seu e-mail e essa senha.',
      });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }
  return (
    <form className="password-form" onSubmit={submit}>
      <h2>{user.hasPassword ? 'Trocar senha' : 'Criar uma senha'}</h2>
      {!user.hasPassword && (
        <p className="muted">Você entra com o Google. Se quiser, crie uma senha para entrar também com seu e-mail.</p>
      )}
      {user.hasPassword && (
        <Field label="Senha atual">
          <input name="current" type="password" required autoComplete="current-password" />
        </Field>
      )}
      <Field label="Nova senha">
        <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
      </Field>
      <Field label="Repita a nova senha">
        <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
      </Field>
      {message && (
        <p className={message.ok ? 'notice' : 'error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <button disabled={busy}>{busy ? 'Salvando…' : user.hasPassword ? 'Trocar senha' : 'Criar senha'}</button>
    </form>
  );
}
