import { brl, displayDate } from '../api';
import type { Box, Dashboard } from '../types';
import { Loading, Progress, href, installmentLabel, useApp, useData } from '../ui';

const progress = (b: Box) => (b.goal ? Math.min(100, Math.round((b.amount * 100) / b.goal)) : 0);
export function BoxCard({ box }: { box: Box }) {
  return (
    <article className="panel box-mini">
      <div className="box-mini-head">
        <span className="box-icon">{box.icon}</span>
        {box.goal && box.amount >= box.goal && <span className="badge success">Meta atingida</span>}
      </div>
      <p className="muted">{box.name}</p>
      <p className="box-amount">{brl(box.amount)}</p>
      {box.goal && (
        <>
          <Progress value={progress(box)} color={box.color} />
          <p className="muted small">
            {progress(box)}% de {brl(box.goal)}
          </p>
        </>
      )}
    </article>
  );
}

export function DashboardPage() {
  const { user, route } = useApp();
  const { data, error } = useData<Dashboard>('/dashboard', route);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="greeting" title={user.name}>
            Olá, {user.name}
          </h1>
          <p className="muted">Aqui está o resumo das suas finanças.</p>
        </div>
      </div>
      <div className="quick-actions">
        <a className="button" href={href('gastos/novo')}>
          + Adicionar gasto
        </a>
        <a className="button secondary" href={href('entradas/nova')}>
          ＋ Adicionar entrada
        </a>
        <a className="button secondary" href={href('cofrinhos')}>
          🐷 Guardar no cofrinho
        </a>
        <a className="button secondary" href={href('financas')}>
          📊 Ver finanças
        </a>
      </div>
      <div className="summary">
        <article className="stat accent">
          <p>Saldo disponível</p>
          <strong>{brl(data.user.balance)}</strong>
        </article>
        <article className="stat">
          <p>Entradas do mês</p>
          <strong className="positive">{brl(data.income)}</strong>
        </article>
        <article className="stat">
          <p>Gastos do mês</p>
          <strong>{brl(data.expense)}</strong>
          {data.toPay > 0 && (
            <a className="stat-link" href={href('financas')}>
              + {brl(data.toPay)} ainda a pagar este mês →
            </a>
          )}
        </article>
      </div>
      <div className="section-heading">
        <h2>Seus cofrinhos</h2>
        <a className="link" href={href('cofrinhos')}>
          Ver todos →
        </a>
      </div>
      {data.boxes.length ? (
        <div className="box-grid compact">
          {data.boxes.map(b => (
            <BoxCard key={b.id} box={b} />
          ))}
        </div>
      ) : (
        <div className="empty panel">
          <p>Você ainda não tem nenhum cofrinho.</p>
          <a className="button" href={href('cofrinhos/novo')}>
            Criar primeiro cofrinho
          </a>
        </div>
      )}
      <div className="section-heading spaced">
        <h2>Últimos lançamentos</h2>
        <a className="link" href={href('gastos')}>
          Ver histórico →
        </a>
      </div>
      <div className="panel list">
        {data.recent.length ? (
          data.recent.map(t => (
            <div className="record-row" key={t.id}>
              <div className="row-main">
                <span className="row-icon">
                  {t.type === 'income' ? t.incomeType?.icon || '💵' : t.category?.icon || '💳'}
                </span>
                <div>
                  <strong>{t.description || (t.type === 'income' ? 'Entrada' : 'Gasto')}</strong>
                  <small>
                    {t.type === 'income' ? t.incomeType?.name || 'Entrada' : t.category?.name || 'Sem categoria'} ·{' '}
                    {displayDate(t.date)}
                    {t.installmentNumber ? ` · parcela ${installmentLabel(t)}` : ''}
                    {t.kind === 'fixo' ? ' · fixo' : ''}
                  </small>
                </div>
              </div>
              <strong className={t.type === 'income' ? 'positive' : ''}>
                {t.type === 'income' ? '+' : '-'} {brl(t.value)}
              </strong>
            </div>
          ))
        ) : (
          <div className="empty">Nenhum lançamento ainda. Que tal adicionar o primeiro?</div>
        )}
      </div>
    </>
  );
}
