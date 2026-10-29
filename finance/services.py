"""
Regras de negócio que mexem em mais de um modelo ao mesmo tempo:

- saldo da carteira (só lançamentos com data já alcançada contam);
- geração automática dos lançamentos fixos mensais;
- criação das parcelas de uma compra parcelada;
- uso de limite e fatura dos cartões;
- projeção dos próximos meses.

As views chamam estas funções em vez de repetir a lógica.
"""

import calendar
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal

from django.db import transaction as db_transaction
from django.db.models import Sum
from django.utils import timezone

from .models import Card, PaymentMethod, Recurrence, Transaction, Wallet

# ---------------------------------------------------------------------------
# Datas
# ---------------------------------------------------------------------------


def add_months(d: date, months: int, day: int | None = None) -> date:
    """Soma meses a uma data, ajustando o dia ao tamanho do mês (31 → 28/30)."""
    total = d.month - 1 + months
    ano, mes = d.year + total // 12, total % 12 + 1
    dia = min(day or d.day, calendar.monthrange(ano, mes)[1])
    return date(ano, mes, dia)


def first_of_month(d: date) -> date:
    return d.replace(day=1)


def last_of_month(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


# ---------------------------------------------------------------------------
# Saldo da carteira
# ---------------------------------------------------------------------------


def efeito_no_saldo(tx: Transaction) -> Decimal:
    """Quanto um lançamento soma/subtrai do saldo — zero se ainda é previsto."""
    if not tx.applied:
        return Decimal("0.00")
    return tx.value if tx.type == Transaction.INCOME else -tx.value


def ajustar_saldo(user, delta: Decimal) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(user=user)
    if delta:
        wallet.balance = wallet.balance + delta
        wallet.save(update_fields=["balance", "updated_at"])
    return wallet


def salvar_lancamento(tx: Transaction, efeito_anterior: Decimal = Decimal("0.00")) -> Wallet:
    """Salva o lançamento decidindo se já conta no saldo (data <= hoje)."""
    tx.applied = tx.date <= timezone.localdate()
    tx.save()
    return ajustar_saldo(tx.user, efeito_no_saldo(tx) - efeito_anterior)


def excluir_lancamentos(user, queryset) -> None:
    """Exclui lançamentos devolvendo ao saldo o efeito dos já aplicados."""
    entradas = queryset.filter(applied=True, type=Transaction.INCOME).aggregate(t=Sum("value"))["t"] or 0
    saidas = queryset.filter(applied=True, type=Transaction.EXPENSE).aggregate(t=Sum("value"))["t"] or 0
    queryset.delete()
    ajustar_saldo(user, Decimal(saidas) - Decimal(entradas))


# ---------------------------------------------------------------------------
# Processamento automático (fixos do mês + previstos que venceram)
# ---------------------------------------------------------------------------


def _data_da_ocorrencia(recorrencia: Recurrence, mes: date) -> date:
    return add_months(mes, 0, day=recorrencia.day_of_month)


def gerar_recorrencias(user, ate: date | None = None) -> int:
    """Gera os lançamentos dos fixos ativos até o mês de `ate` (inclusive).

    O lançamento do mês corrente é gerado mesmo que o dia ainda não tenha
    chegado — ele aparece como "previsto" até a data.
    """
    ate = first_of_month(ate or timezone.localdate())
    criados = 0
    for rec in Recurrence.objects.filter(user=user, active=True):
        mes = add_months(rec.last_generated, 1) if rec.last_generated else first_of_month(rec.start_date)
        while mes <= ate:
            data = _data_da_ocorrencia(rec, mes)
            if data >= rec.start_date and (rec.end_date is None or data <= rec.end_date):
                Transaction.objects.create(
                    user=user,
                    type=rec.type,
                    kind=Transaction.FIXO,
                    value=rec.value,
                    description=rec.description,
                    category=rec.category,
                    income_type=rec.income_type,
                    payment_method=rec.payment_method,
                    card=rec.card,
                    date=data,
                    recurrence=rec,
                    applied=False,
                )
                criados += 1
            rec.last_generated = mes
            mes = add_months(mes, 1)
        rec.save(update_fields=["last_generated"])
    return criados


def aplicar_previstos(user) -> None:
    """Leva para o saldo os lançamentos previstos cuja data já chegou."""
    hoje = timezone.localdate()
    pendentes = Transaction.objects.filter(user=user, applied=False, date__lte=hoje)
    delta = Decimal("0.00")
    for tx in pendentes:
        tx.applied = True
        delta += efeito_no_saldo(tx)
    pendentes.update(applied=True)
    ajustar_saldo(user, delta)


def processar_lancamentos(user) -> None:
    with db_transaction.atomic():
        gerar_recorrencias(user)
        aplicar_previstos(user)


# ---------------------------------------------------------------------------
# Parcelamentos
# ---------------------------------------------------------------------------


def valores_das_parcelas(total: Decimal, n: int) -> list[Decimal]:
    """Divide o total em n parcelas; a diferença de centavos vai na 1ª."""
    base = (total / n).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    primeira = total - base * (n - 1)
    return [primeira] + [base] * (n - 1)


def criar_parcelas(plano) -> None:
    for i, valor in enumerate(valores_das_parcelas(plano.total_value, plano.installments)):
        tx = Transaction(
            user=plano.user,
            type=Transaction.EXPENSE,
            kind=Transaction.PARCELADO,
            value=valor,
            description=plano.description,
            category=plano.category,
            payment_method=plano.payment_method,
            card=plano.card,
            date=add_months(plano.first_date, i),
            installment_plan=plano,
            installment_number=i + 1,
        )
        salvar_lancamento(tx)


# ---------------------------------------------------------------------------
# Cartões
# ---------------------------------------------------------------------------


def periodo_fatura_atual(card: Card, hoje: date | None = None) -> tuple[date, date]:
    """Início e fim (inclusive) da fatura aberta do cartão.

    Sem dia de fechamento cadastrado, a fatura é o mês corrente.
    """
    hoje = hoje or timezone.localdate()
    if not card.closing_day:
        return first_of_month(hoje), last_of_month(hoje)
    fechamento_mes = add_months(hoje, 0, day=card.closing_day)
    if hoje <= fechamento_mes:
        fim = fechamento_mes
    else:
        fim = add_months(hoje, 1, day=card.closing_day)
    inicio = add_months(fim, -1, day=card.closing_day) + timedelta(days=1)
    return inicio, fim


def resumo_cartao(card: Card) -> dict:
    """Fatura atual, limite usado (fatura aberta + parcelas futuras) e disponível."""
    inicio, fim = periodo_fatura_atual(card)
    credito = Transaction.objects.filter(
        card=card, type=Transaction.EXPENSE, payment_method__kind=PaymentMethod.CREDITO
    )
    fatura = credito.filter(date__gte=inicio, date__lte=fim).aggregate(t=Sum("value"))["t"] or Decimal("0")
    usado = credito.filter(date__gte=inicio).aggregate(t=Sum("value"))["t"] or Decimal("0")
    vencimento = add_months(fim, 0 if (card.due_day or 0) > fim.day else 1, day=card.due_day) if card.due_day else None

    resumo = {
        "card": card,
        "fatura_inicio": inicio,
        "fatura_fim": fim,
        "fatura": fatura,
        "usado": usado,
        "vencimento": vencimento,
        "disponivel": None,
        "percentual": None,
    }
    if card.limit:
        resumo["disponivel"] = card.limit - usado
        resumo["percentual"] = min(Decimal("100"), (usado / card.limit * 100)).quantize(Decimal("0.1"))
    return resumo


def ocorrencias_futuras(user, ate: date) -> list[Transaction]:
    """Lançamentos fixos ainda não gerados até `ate` (objetos não salvos,
    só para exibição em "próximos lançamentos")."""
    resultado = []
    for rec in Recurrence.objects.filter(user=user, active=True).select_related("card", "category", "income_type"):
        mes = add_months(rec.last_generated, 1) if rec.last_generated else first_of_month(rec.start_date)
        while mes <= ate:
            data = _data_da_ocorrencia(rec, mes)
            if rec.start_date <= data <= ate and (rec.end_date is None or data <= rec.end_date):
                resultado.append(
                    Transaction(
                        user=user, type=rec.type, kind=Transaction.FIXO, value=rec.value,
                        description=rec.description, card=rec.card, category=rec.category,
                        income_type=rec.income_type, date=data, recurrence=rec, applied=False,
                    )
                )
            mes = add_months(mes, 1)
    return resultado


# ---------------------------------------------------------------------------
# Projeção dos próximos meses
# ---------------------------------------------------------------------------


def projecao_meses(user, meses: int = 6) -> list[dict]:
    """Entradas e saídas previstas para os próximos `meses` meses.

    Soma os lançamentos já existentes (parcelas, fixos gerados) com as
    ocorrências futuras dos fixos ativos que ainda não foram geradas.
    """
    hoje = timezone.localdate()
    recorrencias = list(Recurrence.objects.filter(user=user, active=True))
    resultado = []
    for i in range(1, meses + 1):
        mes = add_months(first_of_month(hoje), i)
        fim = last_of_month(mes)
        qs = Transaction.objects.filter(user=user, date__gte=mes, date__lte=fim)
        entradas = qs.filter(type=Transaction.INCOME).aggregate(t=Sum("value"))["t"] or Decimal("0")
        saidas = qs.filter(type=Transaction.EXPENSE).aggregate(t=Sum("value"))["t"] or Decimal("0")
        parcelas = qs.filter(kind=Transaction.PARCELADO).aggregate(t=Sum("value"))["t"] or Decimal("0")
        fixos = qs.filter(type=Transaction.EXPENSE, kind=Transaction.FIXO).aggregate(t=Sum("value"))["t"] or Decimal("0")

        for rec in recorrencias:
            ja_gerado = rec.last_generated and rec.last_generated >= mes
            data = _data_da_ocorrencia(rec, mes)
            if ja_gerado or data < rec.start_date or (rec.end_date and data > rec.end_date):
                continue
            if rec.type == Transaction.INCOME:
                entradas += rec.value
            else:
                saidas += rec.value
                fixos += rec.value

        resultado.append(
            {
                "mes": mes,
                "entradas": entradas,
                "saidas": saidas,
                "parcelas": parcelas,
                "fixos": fixos,
                "resultado": entradas - saidas,
            }
        )
    return resultado
