import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from './database';
import { today } from './domain';
import { FinanceService } from './finance';

// Crab AI: a chat assistant that answers questions about the signed-in user's own finances.
// Every tool reads data through FinanceService with the caller's userId, so it can never see another account.
export const crabAiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = () => process.env.CRAB_AI_MODEL || 'claude-haiku-5-5';
// US$ per million tokens (input, output, cache read, 5-minute cache write). Haiku 5.5 prices are for prompts up to 100K tokens, which every Crab AI request stays under.
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
};
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
/** Cost in millionths of a dollar; unknown models are priced as Opus 5.5 so the estimate never undercounts. */
export const costMicroUsd = (model: string, u: Usage) => {
  const [input, output, read, write] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  return Math.round(u.input * input + u.output * output + u.cacheRead * read + u.cacheWrite * write);
};
// The server-side refusal fallback exists for the Opus/Sonnet/Fable models only, not for Haiku 5.5.
const supportsFallback = (model: string) => !model.startsWith('claude-haiku');
const MAX_TOOL_ROUNDS = 8;
// Monthly allowance per user, in tokens (input + output + cache). ~1M is about 130 typical questions on Haiku 5.5.
const MONTHLY_TOKENS = () => Number(process.env.CRAB_AI_MONTHLY_TOKENS) || 1_000_000;
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
const nextMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
};

const brl = (cents: bigint | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const inputs = {
  visao_geral: z.object({}).strict(),
  lancamentos: z
    .object({
      de: date.optional(),
      ate: date.optional(),
      tipo: z.enum(['gasto', 'entrada']).optional(),
      modalidade: z.enum(['avista', 'parcelado', 'fixo']).optional(),
      categoria: z.string().max(80).optional(),
      busca: z.string().max(80).optional(),
      limite: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  financas_do_mes: z.object({}).strict(),
  relatorio: z.object({ de: date.optional(), ate: date.optional() }).strict(),
  cofrinhos: z.object({}).strict(),
};
type ToolName = keyof typeof inputs;
const labels: Record<ToolName, string> = {
  visao_geral: 'Olhando seu saldo e o resumo do mês',
  lancamentos: 'Consultando seus lançamentos',
  financas_do_mes: 'Analisando cartões, fixos e projeção',
  relatorio: 'Montando o relatório do período',
  cofrinhos: 'Abrindo seus cofrinhos',
};
const period = {
  de: { type: 'string', description: 'Data inicial AAAA-MM-DD' },
  ate: { type: 'string', description: 'Data final AAAA-MM-DD' },
};
const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'visao_geral',
    description:
      'Saldo disponível, entradas e gastos já realizados no mês atual, quanto falta pagar no mês, total guardado em cofrinhos e últimos lançamentos.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lancamentos',
    description:
      'Lista lançamentos (gastos e entradas) com filtros. Use para perguntas sobre gastos específicos, maiores despesas, onde o dinheiro foi, buscas por descrição. Valores previstos (ainda não pagos) vêm marcados.',
    input_schema: {
      type: 'object',
      properties: {
        ...period,
        tipo: { type: 'string', enum: ['gasto', 'entrada'] },
        modalidade: { type: 'string', enum: ['avista', 'parcelado', 'fixo'] },
        categoria: { type: 'string', description: 'Nome da categoria (gastos) ou do tipo de entrada' },
        busca: { type: 'string', description: 'Trecho da descrição' },
        limite: { type: 'integer', description: 'Máximo de linhas (padrão 50, até 200)' },
      },
    },
  },
  {
    name: 'financas_do_mes',
    description:
      'Compromissos do mês (a receber, a pagar, saldo previsto), dicas e alertas, cartões (fatura, limite usado), projeção dos próximos 6 meses, gastos e entradas fixos, parcelamentos em andamento e próximos 30 dias.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'relatorio',
    description:
      'Totais de um período: entradas, gastos, resultado, gastos por categoria, por modalidade, por forma de pagamento, por cartão, entradas por tipo e evolução dos últimos 6 meses. Sem datas, usa todo o histórico.',
    input_schema: { type: 'object', properties: period },
  },
  {
    name: 'cofrinhos',
    description: 'Cofrinhos (reservas) com valor guardado, meta e progresso.',
    input_schema: { type: 'object', properties: {} },
  },
].map(tool => ({ ...tool, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

const SYSTEM = `Você é o Crab AI, o assistente financeiro do CRAB FINANCE, um app de controle financeiro pessoal. Você conversa com o dono da conta sobre as finanças dele.

Como trabalhar:
- Responda em português do Brasil, com tom amigável e direto, como um amigo que entende de finanças.
- Antes de afirmar qualquer número da conta, consulte as ferramentas. Nunca invente valores, datas ou lançamentos; se um dado não existe na conta, diga isso.
- Valores em reais no formato R$ 1.234,56. Datas no formato DD/MM/AAAA.
- Lançamentos "previstos" ainda não aconteceram (parcelas futuras, fixos do mês que ainda não chegaram); deixe claro quando um total inclui previstos.
- Quando fizer contas, mostre o raciocínio de forma curta (ex.: "R$ 500 de entrada − R$ 320 de gastos = R$ 180").
- Seja objetivo: respostas curtas para perguntas simples; para análises, use poucos tópicos com "- ". Use **negrito** só para destacar o número principal. Não use tabelas nem títulos.
- Você só lê os dados: não consegue criar, editar nem apagar lançamentos. Se pedirem isso, explique onde fazer no app (Gastos, Entradas, Cofrinhos, Finanças, Relatórios, Configurações).
- Pode dar dicas de organização financeira com base nos números da pessoa, sem recomendar produtos de investimento específicos nem prometer rendimentos.
- Fale só de finanças pessoais e do app. Para outros assuntos, diga com gentileza que só pode ajudar com as finanças da conta.`;

const conversationFields = { id: true, title: true, updatedAt: true, pinned: true } as const;
const chatInput = z
  .object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(4000) })
  .strict();
const conversationInput = z
  .object({ title: z.string().trim().min(1).max(80).optional(), pinned: z.boolean().optional() })
  .strict();
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));

@Injectable()
export class CrabAiService {
  private client: Anthropic | null = null;
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(Database) private readonly db: Database,
  ) {}
  private anthropic() {
    return (this.client ??= new Anthropic());
  }

  /** Runs one tool for the signed-in user and returns a compact JSON string for the model. */
  async runTool(userId: string, name: string, raw: unknown): Promise<{ content: string; isError?: boolean }> {
    if (!(name in inputs)) return { content: `Ferramenta desconhecida: ${name}`, isError: true };
    const parsed = inputs[name as ToolName].safeParse(raw ?? {});
    if (!parsed.success)
      return {
        content:
          'Parâmetros inválidos: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        isError: true,
      };
    const input = parsed.data as Record<string, unknown>;
    switch (name as ToolName) {
      case 'visao_geral': {
        const d = await this.finance.dashboard(userId);
        return {
          content: json({
            saldo_disponivel: brl(d.user.balance),
            entradas_do_mes_realizadas: brl(d.income),
            gastos_do_mes_realizados: brl(d.expense),
            ainda_a_pagar_no_mes: brl(d.toPay),
            guardado_em_cofrinhos: brl(d.saved),
            ultimos_lancamentos: d.recent.map(t => ({
              data: t.date,
              descricao: t.description || '(sem descrição)',
              tipo: t.type === 'income' ? 'entrada' : 'gasto',
              valor: brl(t.value),
              categoria: t.category?.name ?? t.incomeType?.name ?? null,
            })),
          }),
        };
      }
      case 'lancamentos': {
        const catalog = await this.finance.catalog(userId);
        const type = input.tipo === 'entrada' ? 'income' : input.tipo === 'gasto' ? 'expense' : undefined;
        const name = typeof input.categoria === 'string' ? input.categoria.toLowerCase() : null;
        const category = name ? catalog.categories.find(c => c.name.toLowerCase() === name) : undefined;
        const incomeType = name ? catalog.incomeTypes.find(c => c.name.toLowerCase() === name) : undefined;
        if (name && !category && !incomeType)
          return {
            content: json({
              erro: `Categoria "${input.categoria}" não existe.`,
              categorias: catalog.categories.map(c => c.name),
              tipos_de_entrada: catalog.incomeTypes.map(c => c.name),
            }),
          };
        let rows = await this.finance.transactions(userId, {
          ...(type ? { type } : {}),
          ...(input.de ? { from: input.de } : {}),
          ...(input.ate ? { to: input.ate } : {}),
          ...(input.modalidade ? { kind: input.modalidade } : {}),
          ...(category ? { categoryId: category.id } : {}),
          ...(incomeType && !category ? { incomeTypeId: incomeType.id } : {}),
        });
        if (typeof input.busca === 'string') {
          const q = input.busca.toLowerCase();
          rows = rows.filter(t => t.description.toLowerCase().includes(q));
        }
        const limit = typeof input.limite === 'number' ? input.limite : 50;
        const total = rows.reduce((s, t) => s + (t.type === 'income' ? t.value : -t.value), 0n);
        return {
          content: json({
            quantidade: rows.length,
            saldo_dos_lancamentos: brl(total),
            mostrando: Math.min(limit, rows.length),
            lancamentos: rows.slice(0, limit).map(t => ({
              data: t.date,
              descricao: t.description || '(sem descrição)',
              tipo: t.type === 'income' ? 'entrada' : 'gasto',
              valor: brl(t.value),
              modalidade: t.kind,
              previsto: !t.applied,
              categoria: t.category?.name ?? t.incomeType?.name ?? null,
              forma: t.paymentMethod?.name ?? null,
              cartao: t.card?.name ?? null,
              parcela: t.installmentNumber ? `${t.installmentNumber}/${t.plan?.installments}` : null,
            })),
          }),
        };
      }
      case 'financas_do_mes': {
        const f = await this.finance.finance(userId);
        return {
          content: json({
            hoje: f.today,
            saldo_atual: brl(f.balance),
            entradas_do_mes: brl(f.incomeMonth),
            gastos_do_mes: brl(f.expenseMonth),
            a_receber: brl(f.toReceive),
            a_pagar: brl(f.toPay),
            saldo_previsto_fim_do_mes: brl(f.projectedBalance),
            dicas: f.tips.map(t => t.text),
            renda_fixa_comprometida_pct: f.commitment,
            cartoes: f.cards.map(c => ({
              nome: c.name,
              fatura_atual: brl(c.invoice),
              fatura: `${c.from} a ${c.to}`,
              vencimento: c.dueDate,
              limite: c.limit === null ? null : brl(c.limit),
              usado: brl(c.used),
              disponivel: c.available === null ? null : brl(c.available),
              pct_limite: c.percent,
            })),
            projecao_6_meses: f.projection.map(p => ({
              mes: p.month.slice(0, 7),
              entradas: brl(p.income),
              saidas: brl(p.expense),
              saldo_previsto: brl(p.balance),
            })),
            gastos_fixos: f.fixedExpenses.map(r => ({
              descricao: r.description,
              valor: brl(r.value),
              dia: r.dayOfMonth,
              ativo: r.active,
            })),
            total_gastos_fixos: brl(f.fixedExpenseTotal),
            entradas_fixas: f.fixedIncomes.map(r => ({
              descricao: r.description,
              valor: brl(r.value),
              dia: r.dayOfMonth,
              ativo: r.active,
            })),
            total_entradas_fixas: brl(f.fixedIncomeTotal),
            parcelamentos: f.activePlans.map(p => ({
              descricao: p.description,
              parcelas: `${p.paid}/${p.installments} pagas`,
              valor_parcela: brl(p.installmentValue),
              falta_pagar: brl(p.remaining),
              termina: p.last,
            })),
            proximos_30_dias: f.upcoming.map(u => ({
              data: u.date,
              descricao: u.description,
              tipo: u.type === 'income' ? 'entrada' : 'gasto',
              valor: brl(u.value),
            })),
          }),
        };
      }
      case 'relatorio': {
        const r = await this.finance.reports(userId, {
          ...(input.de ? { from: input.de } : {}),
          ...(input.ate ? { to: input.ate } : {}),
        });
        const groups = (list: { name: string; value: bigint; percent: number; count: number }[]) =>
          list.map(g => ({ nome: g.name, total: brl(g.value), pct: g.percent, lancamentos: g.count }));
        return {
          content: json({
            periodo: input.de || input.ate ? `${input.de ?? 'início'} a ${input.ate ?? 'hoje'}` : 'todo o histórico',
            entradas: brl(r.income),
            gastos: brl(r.expense),
            resultado: brl(r.net),
            gastos_previstos_incluidos: brl(r.forecastExpense),
            por_categoria: groups(r.byCategory),
            por_modalidade: groups(r.byKind),
            por_forma_de_pagamento: groups(r.byPaymentMethod),
            por_cartao: groups(r.byCard),
            entradas_por_tipo: groups(r.byIncomeType),
            evolucao: r.evolution.map(e => ({
              mes: e.month.slice(0, 7),
              entradas: brl(e.income),
              gastos: brl(e.expense),
            })),
          }),
        };
      }
      case 'cofrinhos': {
        const boxes = await this.finance.boxes(userId);
        return {
          content: json(
            boxes.map(b => ({
              nome: b.name,
              guardado: brl(b.amount),
              meta: b.goal === null ? null : brl(b.goal),
              progresso_pct: b.goal ? Math.min(100, Math.round((Number(b.amount) * 100) / Number(b.goal))) : null,
            })),
          ),
        };
      }
    }
  }

  /**
   * Streams the answer as server-sent events: {type:"text"} deltas, {type:"tool"} progress labels, then {type:"done"} or {type:"error"}.
   * The client keeps the text-only history; tool calls are re-run per question so the data is always current.
   */
  async chat(userId: string, body: unknown, res: Response, signal: AbortSignal) {
    const parsed = chatInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Mensagem inválida.');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, isAdmin: true } });
    if (!user.isAdmin && (await this.monthTokens(userId)) >= MONTHLY_TOKENS())
      throw new HttpException(
        `Você usou todo o Crab AI deste mês. Ele volta em ${nextMonth().toLocaleDateString('pt-BR')}.`,
        429,
      );
    // The conversation and its history live in the database; only the signed-in user's own conversations are reachable.
    const { conversationId, message: question } = parsed.data;
    const conversation = conversationId
      ? await this.db.aiConversation.findFirst({ where: { id: conversationId, userId } })
      : await this.db.aiConversation.create({ data: { userId, title: question.replace(/\s+/g, ' ').slice(0, 60) } });
    if (!conversation) throw new BadRequestException('Conversa não encontrada.');
    // Last 20 turns are enough context for a chat and keep the cost of each question bounded.
    const previous = await this.db.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    await this.db.aiMessage.create({ data: { conversationId: conversation.id, role: 'user', content: question } });
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...previous.reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: question },
    ];
    while (messages.length && messages[0].role !== 'user') messages.shift();
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: Record<string, unknown>) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // Last 20 turns are enough context for a chat and keep the cost of each question bounded.
    let answer = '';
    send({ type: 'conversation', id: conversation.id, title: conversation.title });
    const model = MODEL(),
      usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let rounds = 0;
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        rounds++;
        const stream = this.anthropic().beta.messages.stream(
          {
            model,
            max_tokens: 16000,
            // Chat-style answers: medium effort keeps replies quick while still reasoning over the numbers.
            output_config: { effort: 'medium' },
            // On models that have it, a declined request is re-run on a fallback model picked per refusal category.
            ...(supportsFallback(model)
              ? {
                  betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
                  fallbacks: 'default' as const,
                }
              : {}),
            system: [
              { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: `Hoje é ${today()} (fuso de Recife). O nome da pessoa é ${user.name}.` },
            ],
            tools,
            messages,
          },
          { signal },
        );
        stream.on('text', text => {
          answer += text;
          send({ type: 'text', text });
        });
        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          if (err instanceof Anthropic.APIError || signal.aborted) throw err;
          continue; // a tool input that could not be parsed: re-issue the turn
        }
        usage.input += message.usage.input_tokens;
        usage.output += message.usage.output_tokens;
        usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
        if (message.stop_reason === 'refusal') {
          send({
            type: 'text',
            text: '\n\nNão consigo ajudar com isso. Posso responder sobre as suas finanças no CRAB FINANCE.',
          });
          break;
        }
        if (message.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: message.content });
          continue;
        }
        const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (message.stop_reason !== 'tool_use' || !calls.length) break;
        messages.push({ role: 'assistant', content: message.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          send({ type: 'tool', label: labels[call.name as ToolName] ?? 'Consultando seus dados' });
          const result = await this.runTool(userId, call.name, call.input).catch(() => ({
            content: 'Erro ao consultar os dados.',
            isError: true,
          }));
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: result.content,
            ...(result.isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
        if (round === MAX_TOOL_ROUNDS)
          send({
            type: 'text',
            text: '\n\nPrecisei consultar dados demais para essa pergunta. Pode refazê-la de forma mais específica?',
          });
      }
      if (answer.trim()) {
        const saved = await this.db.aiMessage.create({
          data: { conversationId: conversation.id, role: 'assistant', content: answer.trim() },
        });
        answer = ''; // stored; the cleanup below must not store it again
        send({ type: 'done', messageId: saved.id });
      } else send({ type: 'done' });
    } catch (err) {
      if (!signal.aborted) {
        console.error('Crab AI', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
        send({
          type: 'error',
          message:
            err instanceof Anthropic.RateLimitError
              ? 'Muita gente perguntando agora. Tente de novo em instantes.'
              : 'O Crab AI não conseguiu responder agora. Tente de novo.',
        });
      }
    } finally {
      res.end();
      if (answer.trim())
        await this.db.aiMessage
          .create({ data: { conversationId: conversation.id, role: 'assistant', content: answer.trim() } })
          .catch(err => console.error('Crab AI message', err));
      await this.db.aiConversation
        .update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
        .catch(() => {});
      if (rounds)
        await this.db.aiUsage
          .create({
            data: {
              userId,
              model,
              rounds,
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheReadTokens: usage.cacheRead,
              cacheWriteTokens: usage.cacheWrite,
              costMicroUsd: costMicroUsd(model, usage),
            },
          })
          .catch(err => console.error('Crab AI usage', err));
    }
  }

  async conversations(userId: string) {
    return this.db.aiConversation.findMany({
      where: { userId },
      select: conversationFields,
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
  }
  async conversation(userId: string, id: string) {
    const found = await this.db.aiConversation.findFirst({
      where: { id, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, saved: true } },
      },
    });
    if (!found) throw new NotFoundException('Conversa não encontrada.');
    return found;
  }
  /** Renames or pins a conversation. */
  async updateConversation(userId: string, id: string, body: unknown) {
    const input = conversationInput.safeParse(body);
    if (!input.success) throw new BadRequestException('Dados inválidos.');
    const { count } = await this.db.aiConversation.updateMany({ where: { id, userId }, data: input.data });
    if (!count) throw new NotFoundException('Conversa não encontrada.');
    return this.db.aiConversation.findUniqueOrThrow({ where: { id }, select: conversationFields });
  }
  /** Finds conversations by title or by the text of any message, with a short excerpt of the match. */
  async search(userId: string, query: unknown) {
    const q = typeof query === 'string' ? query.trim().slice(0, 80) : '';
    if (q.length < 2) return [];
    const rows = await this.db.aiConversation.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        messages: { where: { content: { contains: q, mode: 'insensitive' } }, select: { content: true }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return rows.map(({ messages, ...c }) => {
      const text = messages[0]?.content ?? '',
        at = text.toLowerCase().indexOf(q.toLowerCase());
      return {
        ...c,
        excerpt:
          at < 0
            ? ''
            : (at > 40 ? '…' : '') +
              text.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, ' ') +
              (at + q.length + 60 < text.length ? '…' : ''),
      };
    });
  }
  async artifacts(userId: string) {
    return this.db.aiMessage.findMany({
      where: { saved: true, role: 'assistant', conversation: { userId } },
      select: { id: true, content: true, createdAt: true, conversation: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  async saveMessage(userId: string, id: string, body: unknown) {
    const input = z.object({ saved: z.boolean() }).strict().safeParse(body);
    if (!input.success) throw new BadRequestException('Dados inválidos.');
    const { count } = await this.db.aiMessage.updateMany({
      where: { id, role: 'assistant', conversation: { userId } },
      data: { saved: input.data.saved },
    });
    if (!count) throw new NotFoundException('Mensagem não encontrada.');
    return { ok: true };
  }
  async deleteConversation(userId: string, id: string) {
    const { count } = await this.db.aiConversation.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Conversa não encontrada.');
    return { ok: true };
  }

  private async monthTokens(userId: string) {
    const r = await this.db.aiUsage.aggregate({
      where: { userId, createdAt: { gte: monthStart() } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
    });
    return (
      (r._sum.inputTokens ?? 0) +
      (r._sum.outputTokens ?? 0) +
      (r._sum.cacheReadTokens ?? 0) +
      (r._sum.cacheWriteTokens ?? 0)
    );
  }

  /** How much of this month's allowance is used, as a percentage only (token counts are not exposed). */
  async usage(userId: string) {
    const { isAdmin } = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { isAdmin: true } });
    const percent = Math.min(100, Math.round(((await this.monthTokens(userId)) * 1000) / MONTHLY_TOKENS()) / 10);
    return {
      percent,
      blocked: !isAdmin && percent >= 100,
      unlimited: isAdmin,
      renewsOn: nextMonth().toISOString().slice(0, 10),
    };
  }
}
