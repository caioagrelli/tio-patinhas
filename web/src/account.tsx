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
