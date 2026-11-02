import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { href, Loading, useApp, useData } from '../ui';
import { PixelCrab } from '../login';

type Message = { id?: string; role: 'user' | 'assistant'; content: string; saved?: boolean };
type Conversation = { id: string; title: string; updatedAt: string; pinned: boolean };
type Mood = 'idle' | 'thinking' | 'talking' | 'happy';
type UsageData = { percent: number; blocked: boolean; unlimited: boolean; renewsOn: string };
const shortDay = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const suggestions = [
  'Quanto eu gastei este mês?',
  'Onde posso economizar?',
  'Como estão meus cartões?',
  'Vou fechar o mês no positivo?',
  'Quais são meus maiores gastos fixos?',
];

/** Monthly allowance as a bar that fills up; no token or question counts are shown. */
function UsageBar({ data }: { data: UsageData }) {
  const level = data.percent >= 100 ? 'full' : data.percent >= 80 ? 'high' : '';
  return (
    <div className={'ai-bar ' + level}>
      <div
        className="ai-bar-track"
        role="progressbar"
        aria-label="Uso do Crab AI neste mês"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(data.percent)}
      >
        <div style={{ width: Math.max(data.percent, data.percent > 0 ? 2 : 0) + '%' }} />
      </div>
      {data.blocked && (
        <p className="small">Você usou todo o Crab AI deste mês. Ele volta em {shortDay(data.renewsOn)}.</p>
      )}
    </div>
  );
}

// Minimal, safe rendering of the assistant's markdown: paragraphs, "- " lists and **bold**. No HTML is injected.
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      list.push(item[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

/**
 * The crab walks along the lane while idle and stops exactly where it is to react (thinking, talking, celebrating).
 * Its position is driven frame by frame from code, so a change of mood never makes it jump.
 */
function CrabActor({ mood }: { mood: Mood }) {
  const lane = useRef<HTMLDivElement>(null),
    moodRef = useRef(mood);
  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);
  useEffect(() => {
    const walker = lane.current!.querySelector<HTMLElement>('.crab-walker')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let x = 8,
      direction = 1,
      last = 0,
      frame = 0;
    const tick = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      const max = Math.max(0, lane.current!.clientWidth - walker.offsetWidth - 8);
      if (!still && moodRef.current === 'idle') {
        x += direction * 46 * dt;
        if (x >= max) {
          x = max;
          direction = -1;
        } else if (x <= 8) {
          x = 8;
          direction = 1;
        }
      }
      x = Math.min(x, max);
      walker.style.transform = `translateX(${x}px)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={lane} className={'ai-crab-lane ' + mood + (mood === 'idle' ? ' moving' : '')}>
      <PixelCrab>
        <span className="crab-bubble">
          {mood === 'thinking' ? (
            <>
              <i />
              <i />
              <i />
            </>
          ) : mood === 'talking' ? (
            '!'
          ) : mood === 'happy' ? (
            '♥'
          ) : (
            ''
          )}
        </span>
      </PixelCrab>
    </div>
  );
}

const isId = (value?: string) => !!value && /^[0-9a-f-]{36}$/i.test(value);
const paths = {
  new: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  artifacts: 'M6 3h12v18l-6-4-6 4z',
  panel: 'M3 4h18v16H3zM9 4v16',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
function Icon({ d }: { d: string }) {
  return (
    <svg className="ai-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Recent first, grouped like a regular assistant: today, yesterday, last 7 and 30 days, older. */
function groups(list: Conversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const label = (iso: string) => {
    const days = Math.round((today.getTime() - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
    return days <= 0
      ? 'Hoje'
      : days === 1
        ? 'Ontem'
        : days <= 7
          ? 'Últimos 7 dias'
          : days <= 30
            ? 'Últimos 30 dias'
            : 'Mais antigas';
  };
  const out: [string, Conversation[]][] = [];
  for (const c of list) {
    const l = label(c.updatedAt),
      g = out.find(([name]) => name === l);
    if (g) g[1].push(c);
    else out.push([l, [c]]);
  }
  return out;
}

/** Closes a popup on a click outside it or on Escape. */
function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null),
    closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return ref;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useDismiss<HTMLDivElement>(true, close);
  return (
    <div className="ai-modal-backdrop">
      <div ref={ref} className="ai-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ai-modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConversationItem({
  c,
  active,
  reload,
  onDeleted,
}: {
  c: Conversation;
  active: boolean;
  reload: () => void;
  onDeleted: (c: Conversation) => void;
}) {
  const [menu, setMenu] = useState(false),
    [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState(c.title);
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const patch = async (data: Partial<Conversation>) => {
    setMenu(false);
    try {
      await api('/ai/conversations/' + c.id, 'PATCH', data);
    } catch (err) {
      alert((err as Error).message);
    }
    reload();
  };
  const rename = () => {
    setRenaming(false);
    const t = title.trim();
    if (t && t !== c.title) void patch({ title: t });
    else setTitle(c.title);
  };
  async function remove() {
    setMenu(false);
    if (!confirm(`Excluir a conversa "${c.title}"? Isso não pode ser desfeito.`)) return;
    try {
      await api('/ai/conversations/' + c.id, 'DELETE');
      onDeleted(c);
    } catch (err) {
      alert((err as Error).message);
    }
  }
  return (
    <div ref={ref} className={'ai-history-item' + (active ? ' active' : '') + (menu ? ' menu-open' : '')}>
      {renaming ? (
        <input
          className="ai-rename"
          aria-label="Novo nome da conversa"
          autoFocus
          maxLength={80}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={e => {
            if (e.key === 'Enter') rename();
            if (e.key === 'Escape') {
              setTitle(c.title);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <a
          href={href('crab-ai/' + c.id)}
          title={c.title}
          aria-current={active ? 'page' : undefined}
          onDoubleClick={e => {
            e.preventDefault();
            setRenaming(true);
          }}
        >
          {c.pinned && (
            <span className="ai-pin" aria-label="Fixada">
              •
            </span>
          )}
          {c.title}
        </a>
      )}
      {!renaming && (
        <button
          type="button"
          className="ai-dots"
          aria-label={`Opções da conversa ${c.title}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(m => !m)}
        >
          ⋯
        </button>
      )}
      {menu && (
        <div className="ai-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setRenaming(true);
            }}
          >
            Renomear
          </button>
          <button type="button" role="menuitem" onClick={() => void patch({ pinned: !c.pinned })}>
            {c.pinned ? 'Desafixar' : 'Fixar'}
          </button>
          <button type="button" role="menuitem" className="danger-item" onClick={() => void remove()}>
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

type SidebarProps = {
  collapsed: boolean;
  toggle: () => void;
  activeId: string | null;
  view: string;
  conversations: Conversation[] | null;
  reload: () => void;
  onSearch: () => void;
  onNew: () => void;
  onDeleted: (c: Conversation) => void;
  closeDrawer: () => void;
};
function Sidebar({
  collapsed,
  toggle,
  activeId,
  view,
  conversations,
  reload,
  onSearch,
  onNew,
  onDeleted,
  closeDrawer,
}: SidebarProps) {
  const all = conversations ?? [];
  const pinned = all.filter(c => c.pinned),
    loose = all.filter(c => !c.pinned);
  const item = (c: Conversation) => (
    <ConversationItem key={c.id} c={c} active={c.id === activeId} reload={reload} onDeleted={onDeleted} />
  );
  const nav: [string, string, string, (() => void) | undefined, boolean][] = [
    ['Nova conversa', href('crab-ai'), paths.new, onNew, view === 'chat' && !activeId],
    ['Pesquisar conversas', '', paths.search, onSearch, false],
    ['Artefatos', href('crab-ai/artefatos'), paths.artifacts, undefined, view === 'artefatos'],
  ];
  return (
    <aside className="ai-sidebar" aria-label="Menu do Crab AI">
      <div className="ai-side-head">
        <a className="ai-logo" href={href('crab-ai')} onClick={onNew} title="Nova conversa">
          <img src="/logo.png" alt="" />
          <span>Crab AI</span>
        </a>
        <button
          type="button"
          className="ai-collapse"
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <Icon d={paths.panel} />
        </button>
      </div>
      <nav className="ai-nav" aria-label="Crab AI">
        {nav.map(([label, link, icon, action, current]) =>
          link ? (
            <a
              key={label}
              className="ai-nav-item"
              href={link}
              data-tip={label}
              aria-current={current ? 'page' : undefined}
              onClick={() => {
                action?.();
                closeDrawer();
              }}
            >
              <Icon d={icon} />
              <span>{label}</span>
            </a>
          ) : (
            <button key={label} type="button" className="ai-nav-item" data-tip={label} onClick={action}>
              <Icon d={icon} />
              <span>{label}</span>
              <kbd>Ctrl K</kbd>
            </button>
          ),
        )}
      </nav>
      <section className="ai-history" aria-label="Conversas">
        {!conversations ? (
          <p className="muted small ai-pad">Carregando…</p>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="ai-history-group">
                <p className="ai-history-label">Fixadas</p>
                {pinned.map(item)}
              </div>
            )}
            {groups(loose).map(([label, items]) => (
              <div key={label} className="ai-history-group">
                <p className="ai-history-label">{label}</p>
                {items.map(item)}
              </div>
            ))}
          </>
        )}
      </section>
    </aside>
  );
}

function SearchDialog({ close }: { close: () => void }) {
  const [q, setQ] = useState(''),
    [results, setResults] = useState<(Conversation & { excerpt: string })[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<(Conversation & { excerpt: string })[]>(
        '/ai/search?q=' + encodeURIComponent(q.trim()),
        'GET',
        undefined,
        controller.signal,
      )
        .then(setResults)
        .catch(() => {});
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  return (
    <Modal title="Pesquisar conversas" close={close}>
      <input
        className="ai-search-input"
        autoFocus
        type="search"
        placeholder="Busque pelo título ou pelo que foi dito…"
        aria-label="Termo da pesquisa"
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      <div className="ai-search-results">
        {q.trim().length < 2 || results === null ? (
          <p className="muted small">{q.trim().length < 2 ? 'Digite pelo menos 2 letras.' : 'Buscando…'}</p>
        ) : results.length === 0 ? (
          <p className="muted small">Nada encontrado.</p>
        ) : (
          results.map(r => (
            <a key={r.id} href={href('crab-ai/' + r.id)} onClick={close}>
              <strong>{r.title}</strong>
              {r.excerpt && <span className="muted small">{r.excerpt}</span>}
            </a>
          ))
        )}
      </div>
    </Modal>
  );
}

type ChatProps = { conversationId: string | null; onCreated: (id: string) => void; onChanged: () => void };
/** Loads a saved conversation before showing it; a new chat starts empty. */
function ChatView(props: ChatProps) {
  const opened = useData<{ title: string; messages: Message[] }>(
    props.conversationId ? '/ai/conversations/' + props.conversationId : null,
  );
  if (props.conversationId && !opened.data) return <Loading error={opened.error} />;
  return <Chat {...props} initial={opened.data?.messages ?? []} />;
}

function Chat({ conversationId, initial, onCreated, onChanged }: ChatProps & { initial: Message[] }) {
  const { user, unauthorized } = useApp();
  const [usageVersion, setUsageVersion] = useState(0);
  const usage = useData<UsageData>('/ai/usage', usageVersion);
  const [currentId, setCurrentId] = useState(conversationId);
  const [messages, setMessages] = useState<Message[]>(initial);
  const [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [tool, setTool] = useState(''),
    [error, setError] = useState(''),
    [happy, setHappy] = useState(false);
  const end = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null),
    box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  useEffect(() => {
    box.current?.focus();
    return () => abort.current?.abort();
  }, []);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setError('');
    setInput('');
    setBusy(true);
    setTool('Pensando');
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    const controller = new AbortController();
    abort.current = controller;
    const updateLast = (change: (m: Message) => Message) =>
      setMessages(all => {
        const copy = [...all];
        copy[copy.length - 1] = change(copy[copy.length - 1]);
        return copy;
      });
    try {
      const body = currentId ? { message: text, conversationId: currentId } : { message: text };
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'CrabFinance' },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        unauthorized();
        return;
      }
      if (response.status === 402) {
        location.hash = '#/planos';
        return;
      }
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        const friendly = data.message && !data.message.startsWith('ThrottlerException') ? data.message : null;
        throw new Error(
          friendly ??
            (response.status === 429
              ? 'Você fez muitas perguntas seguidas. Espere um minuto.'
              : 'O Crab AI não conseguiu responder agora.'),
        );
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const raw of events) {
          if (!raw.startsWith('data: ')) continue;
          const event = JSON.parse(raw.slice(6)) as {
            type: string;
            text?: string;
            label?: string;
            message?: string;
            id?: string;
            messageId?: string;
          };
          if (event.type === 'conversation' && event.id && event.id !== currentId) {
            // A new chat gets its own address without reloading, and shows up in the sidebar right away.
            setCurrentId(event.id);
            history.replaceState(null, '', '#/crab-ai/' + event.id);
            onCreated(event.id);
          } else if (event.type === 'text' && event.text) {
            const chunk = event.text;
            setTool('');
            updateLast(m => ({ ...m, content: m.content + chunk }));
          } else if (event.type === 'tool') setTool(event.label ?? 'Consultando seus dados');
          else if (event.type === 'done' && event.messageId) {
            const id = event.messageId;
            updateLast(m => ({ ...m, id }));
          } else if (event.type === 'error') throw new Error(event.message);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : 'O Crab AI não conseguiu responder agora.');
    } finally {
      setMessages(all => (all.at(-1)?.role === 'assistant' && !all.at(-1)!.content.trim() ? all.slice(0, -1) : all));
      setBusy(false);
      setTool('');
      abort.current = null;
      box.current?.focus();
      setUsageVersion(v => v + 1);
      onChanged();
      if (!controller.signal.aborted) {
        setHappy(true);
        setTimeout(() => setHappy(false), 1600);
      }
    }
  }
  async function toggleSaved(i: number) {
    const m = messages[i];
    if (!m.id) return;
    try {
      await api('/ai/messages/' + m.id, 'PATCH', { saved: !m.saved });
      setMessages(all => all.map((x, j) => (j === i ? { ...x, saved: !x.saved } : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };
  const last = messages.at(-1);
  const mood: Mood = busy ? (tool || !last?.content ? 'thinking' : 'talking') : happy ? 'happy' : 'idle';
  return (
    <>
      <div className="chat" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="pixel-heading small">Olá, {user.name.split(' ')[0]}! 🦀</p>
            <p className="muted">
              Eu leio seus lançamentos, cartões, fixos, parcelamentos e cofrinhos para responder. Experimente:
            </p>
            <div className="chips">
              {suggestions.map(s => (
                <button key={s} type="button" className="chip secondary" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'bubble-row ' + m.role}>
            {m.role === 'assistant' && <img src="/logo.png" alt="" className="crab-ai-avatar" />}
            <div className="bubble-col">
              <div className={'bubble ' + m.role}>
                {m.role === 'assistant' ? m.content ? <Rich text={m.content} /> : null : m.content}
                {busy && i === messages.length - 1 && m.role === 'assistant' && (tool || !m.content) && (
                  <span className="thinking">
                    {tool || 'Pensando'}
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              {m.role === 'assistant' && m.id && !(busy && i === messages.length - 1) && (
                <div className="bubble-actions">
                  <button type="button" className="link" onClick={() => void navigator.clipboard?.writeText(m.content)}>
                    Copiar
                  </button>
                  <button
                    type="button"
                    className={'link' + (m.saved ? ' saved' : '')}
                    aria-pressed={!!m.saved}
                    onClick={() => void toggleSaved(i)}
                  >
                    {m.saved ? '★ Salvo em artefatos' : '☆ Salvar'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="composer">
        <CrabActor mood={mood} />
        <form className="chat-input" onSubmit={submit}>
          <textarea
            ref={box}
            rows={1}
            maxLength={4000}
            placeholder="Pergunte algo sobre suas finanças…"
            aria-label="Pergunta para o Crab AI"
            value={input}
            disabled={busy || usage.data?.blocked}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="secondary" onClick={() => abort.current?.abort()}>
              Parar
            </button>
          ) : (
            <button disabled={!input.trim() || usage.data?.blocked}>Enviar</button>
          )}
        </form>
        {usage.data && <UsageBar data={usage.data} />}
      </div>
    </>
  );
}

function ArtifactsView() {
  const [version, setVersion] = useState(0);
  const list = useData<
    { id: string; content: string; createdAt: string; conversation: { id: string; title: string } }[]
  >('/ai/artifacts', version);
  async function unsave(id: string) {
    await api('/ai/messages/' + id, 'PATCH', { saved: false });
    setVersion(v => v + 1);
  }
  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <h2>Artefatos</h2>
      </div>
      <p className="muted">Respostas do Crab AI que você salvou: análises, planos e resumos para consultar depois.</p>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <div className="empty panel">
          <p>Nada salvo ainda.</p>
          <p className="muted small">Toque em “☆ Salvar” embaixo de uma resposta para guardá-la aqui.</p>
        </div>
      ) : (
        list.data.map(a => (
          <article key={a.id} className="panel ai-artifact">
            <header>
              <a href={href('crab-ai/' + a.conversation.id)}>{a.conversation.title}</a>
              <span className="muted small">{new Date(a.createdAt).toLocaleDateString('pt-BR')}</span>
            </header>
            <div className="ai-artifact-body">
              <Rich text={a.content} />
            </div>
            <div className="bubble-actions">
              <button type="button" className="link" onClick={() => void navigator.clipboard?.writeText(a.content)}>
                Copiar
              </button>
              <button type="button" className="link" onClick={() => void unsave(a.id)}>
                Remover dos artefatos
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

export function CrabAiPage() {
  const { route, go } = useApp();
  const status = useData<{ enabled: boolean }>('/ai/status');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('crab-ai:collapsed') === '1');
  useEffect(() => {
    localStorage.setItem('crab-ai:collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  const conversations = useData<Conversation[]>('/ai/conversations', version);
  const [drawer, setDrawer] = useState(false),
    [searching, setSearching] = useState(false);
  // Every navigation (even back to the same address) opens a fresh view; a chat created here keeps running.
  const [nav, setNav] = useState(0),
    [created, setCreated] = useState<string | null>(null);
  const [seenRoute, setSeenRoute] = useState(route);
  if (seenRoute !== route) {
    setSeenRoute(route);
    setNav(n => n + 1);
    setCreated(null);
    setDrawer(false);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const [, sub] = route.path;
  const view = sub === 'artefatos' ? 'artefatos' : 'chat';
  const activeId = isId(sub) ? sub! : created;
  const onDeleted = (c: Conversation) => {
    reload();
    if (c.id === activeId) go('crab-ai');
  };
  const onNew = () => {
    if (location.hash === '#/crab-ai') setNav(n => n + 1);
    setCreated(null);
    setDrawer(false);
  };
  let content: ReactNode;
  if (!status.data) content = <Loading error={status.error} />;
  else if (!status.data.enabled)
    content = (
      <div className="empty panel">
        <p>O Crab AI ainda não foi configurado neste servidor.</p>
        <p className="muted small">Falta definir a chave da API da Anthropic (ANTHROPIC_API_KEY).</p>
      </div>
    );
  else if (view === 'artefatos') content = <ArtifactsView key={nav} />;
  else
    content = (
      <ChatView
        key={nav}
        conversationId={isId(sub) ? sub! : null}
        onCreated={newId => {
          setCreated(newId);
          reload();
        }}
        onChanged={reload}
      />
    );
  const title =
    view === 'chat' ? (conversations.data?.find(c => c.id === activeId)?.title ?? 'Nova conversa') : 'Artefatos';
  return (
    <div className={'ai-app' + (collapsed ? ' collapsed' : '') + (drawer ? ' drawer-open' : '')}>
      <Sidebar
        collapsed={collapsed}
        toggle={() => setCollapsed(c => !c)}
        activeId={activeId}
        view={view}
        conversations={conversations.data}
        reload={reload}
        onSearch={() => {
          setDrawer(false);
          setSearching(true);
        }}
        onNew={onNew}
        onDeleted={onDeleted}
        closeDrawer={() => setDrawer(false)}
      />
      <button
        type="button"
        className="ai-drawer-backdrop link"
        aria-label="Fechar menu"
        tabIndex={drawer ? 0 : -1}
        onClick={() => setDrawer(false)}
      />
      <section className={'ai-main view-' + view}>
        <h1 className="sr-only">Crab AI</h1>
        <div className="ai-topbar">
          <button
            type="button"
            className="ai-icon-btn"
            aria-label="Abrir menu"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Icon d={paths.menu} />
          </button>
          <span className="ai-topbar-title">{title}</span>
          <a className="ai-icon-btn" href={href('crab-ai')} onClick={onNew} aria-label="Nova conversa">
            <Icon d={paths.new} />
          </a>
        </div>
        {content}
      </section>
      {searching && <SearchDialog close={() => setSearching(false)} />}
    </div>
  );
}
