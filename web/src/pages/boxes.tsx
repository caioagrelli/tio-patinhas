import { useState, type FormEvent } from 'react';
import { api, brl, cents, displayDate } from '../api';
import type { Box, Dashboard } from '../types';
import { ConfirmDelete, Empty, Field, Loading, MoneyInput, PageHeader, Progress, href, useApp, useData } from '../ui';

const progress = (b: Box) => (b.goal ? Math.min(100, Math.round((b.amount * 100) / b.goal)) : 0);
const findBox = (boxes: Box[] | null, id: string) => boxes?.find(b => b.id === id);

export function BoxList() {
  const { route } = useApp();
  const boxes = useData<Box[]>('/boxes', route),
    wallet = useData<Dashboard>('/dashboard', route);
  return (
    <>
      <PageHeader
        title="Cofrinhos"
        subtitle={
          <>
            Saldo disponível para guardar:{' '}
            <strong className="accent-text">{wallet.data ? brl(wallet.data.user.balance) : '…'}</strong>
          </>
        }
      >
        <a className="button" href={href('cofrinhos/novo')}>
          + Novo cofrinho
        </a>
      </PageHeader>
      {!boxes.data ? (
        <Loading error={boxes.error} />
      ) : boxes.data.length ? (
        <div className="box-grid">
          {boxes.data.map(b => (
            <article className="panel savings" key={b.id} style={{ borderTop: `3px solid ${b.color}` }}>
              <div className="box-mini-head">
                <span className="box-icon">{b.icon}</span>
                <small className="muted">{displayDate(b.createdAt)}</small>
              </div>
              <h3>{b.name}</h3>
              <p className="box-amount">{brl(b.amount)}</p>
              {b.goal ? (
                <>
                  <Progress value={progress(b)} color={b.color} />
                  <p className="muted small">
                    {progress(b)}% da meta de {brl(b.goal)}
                  </p>
                  {b.amount >= b.goal && <span className="badge success">🎉 Meta atingida</span>}
                </>
              ) : (
                <p className="muted small">Sem meta definida</p>
              )}
              <div className="box-buttons">
                <a className="button" href={href(`cofrinhos/${b.id}/depositar`)}>
                  Depositar
                </a>
                <a className="button secondary" href={href(`cofrinhos/${b.id}/resgatar`)}>
                  Resgatar
                </a>
              </div>
              <div className="row-actions">
                <a className="link" href={href(`cofrinhos/${b.id}/editar`)}>
                  Editar
                </a>
                <a className="link danger" href={href(`cofrinhos/${b.id}/excluir`)}>
                  Excluir
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          <p>Você ainda não tem nenhum cofrinho.</p>
          <a className="button" href={href('cofrinhos/novo')}>
            Criar primeiro cofrinho
          </a>
        </Empty>
      )}
    </>
  );
}

export function BoxForm({ id }: { id?: string }) {
  const { go } = useApp();
  const boxes = useData<Box[]>(id ? '/boxes' : null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const box = id ? findBox(boxes.data, id) : undefined;
  if (id && !box) return <Loading error={boxes.error || (boxes.data ? 'Cofrinho não encontrado.' : '')} />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.currentTarget),
      goal = String(f.get('goal') || '');
    try {
      const body = {
        name: String(f.get('name')),
        icon: String(f.get('icon')),
        color: String(f.get('color')),
        goal: goal ? cents(goal) : null,
      };
      await api('/boxes' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
      go('cofrinhos', [{ kind: 'success', text: id ? 'Cofrinho atualizado!' : `Cofrinho "${body.name}" criado!` }]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <h1>{id ? 'Editar' : 'Novo'} cofrinho</h1>
      <p className="muted">
        {id ? 'O valor guardado só muda por depósito/resgate.' : 'Ex: Viagem, Emergência, Reserva...'}
      </p>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome">
          <input name="name" required maxLength={80} defaultValue={box?.name} placeholder="Ex: Viagem" />
        </Field>
        <Field label="Meta (R$)">
          <MoneyInput name="goal" value={box?.goal} required={false} />
        </Field>
        <div className="form-row">
          <Field label="Ícone">
            <input name="icon" maxLength={20} defaultValue={box?.icon || '🐷'} />
          </Field>
          <Field label="Cor">
            <input name="color" type="color" defaultValue={box?.color || '#f64301'} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions start">
          <button disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <a className="button secondary" href={href('cofrinhos')}>
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}

export function BoxMovement({ id, action }: { id: string; action: 'deposit' | 'withdraw' }) {
  const { go } = useApp();
  const boxes = useData<Box[]>('/boxes'),
    wallet = useData<Dashboard>('/dashboard');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const box = findBox(boxes.data, id);
  if (!box || !wallet.data)
    return <Loading error={boxes.error || wallet.error || (boxes.data && !box ? 'Cofrinho não encontrado.' : '')} />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const value = cents(String(new FormData(e.currentTarget).get('value')));
      await api(`/boxes/${id}/movements`, 'POST', { type: action, value });
      go('cofrinhos', [
        {
          kind: 'success',
          text:
            action === 'deposit'
              ? `${brl(value)} guardado(s) em "${box!.name}".`
              : `${brl(value)} resgatado(s) de "${box!.name}".`,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="form-page narrow">
      <span className="box-icon big">{box.icon}</span>
      <h1>
        {action === 'deposit' ? 'Depositar em' : 'Resgatar de'} "{box.name}"
      </h1>
      <p className="muted">
        {action === 'deposit'
          ? `Saldo disponível: ${brl(wallet.data.user.balance)}`
          : `Valor guardado neste cofrinho: ${brl(box.amount)}`}
      </p>
      <form onSubmit={submit} className="form-grid">
        <Field label="Valor (R$)">
          <MoneyInput />
        </Field>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions start">
          <button disabled={busy}>Confirmar {action === 'deposit' ? 'depósito' : 'resgate'}</button>
          <a className="button secondary" href={href('cofrinhos')}>
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}

export function BoxDelete({ id }: { id: string }) {
  const { go } = useApp();
  const boxes = useData<Box[]>('/boxes');
  const box = findBox(boxes.data, id);
  if (!box) return <Loading error={boxes.error || (boxes.data ? 'Cofrinho não encontrado.' : '')} />;
  return (
    <ConfirmDelete
      title={`Excluir "${box.name}"`}
      cancel="cofrinhos"
      detail={`O valor guardado (${brl(box.amount)}) será devolvido ao seu saldo principal.`}
      onConfirm={async () => {
        await api('/boxes/' + id, 'DELETE');
        go('cofrinhos', [
          { kind: 'success', text: `Cofrinho "${box.name}" excluído. O valor guardado voltou para o seu saldo.` },
        ]);
      }}
    />
  );
}
