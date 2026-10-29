"""
Views do app finance.

Todas as views (exceto login/registro) exigem usuário autenticado via
`@login_required`, e todo QuerySet é sempre filtrado por `user=request.user`,
garantindo que cada pessoa só veja e altere os próprios dados.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_login_out
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncMonth
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.formats import date_format

from .forms import (
    CardForm,
    CategoryForm,
    IncomeTypeForm,
    InstallmentPlanForm,
    LancamentoForm,
    LoginForm,
    PaymentMethodForm,
    PeriodFilterForm,
    RecurrenceForm,
    RegisterForm,
    SavingsBoxForm,
    SavingsMovementForm,
    TransactionEditForm,
    categorias_disponiveis_para,
)
from .models import (
    Card,
    Category,
    IncomeType,
    InstallmentPlan,
    PaymentMethod,
    Recurrence,
    SavingsBox,
    SavingsMovement,
    Transaction,
    Wallet,
)
from .services import (
    add_months,
    ajustar_saldo,
    aplicar_previstos,
    criar_parcelas,
    efeito_no_saldo,
    excluir_lancamentos,
    first_of_month,
    gerar_recorrencias,
    last_of_month,
    ocorrencias_futuras,
    projecao_meses,
    resumo_cartao,
    salvar_lancamento,
)


# ---------------------------------------------------------------------------
# Autenticação
# ---------------------------------------------------------------------------


class TelaLoginView(LoginView):
    """Tela de login. É a página raiz ("/") do sistema."""

    template_name = "finance/login.html"
    redirect_authenticated_user = True
    authentication_form = LoginForm


def registrar_view(request):
    """Cadastro de nova conta (nome, e-mail, usuário e senha).

    Ao salvar o usuário, o signal `criar_wallet_do_usuario` já cria a
    carteira automaticamente. Em seguida, fazemos login automático e
    mandamos a pessoa direto para o dashboard.
    """
    if request.user.is_authenticated:
        return redirect("dashboard")

    if request.method == "POST":
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            auth_login(request, user)
            messages.success(request, f"Bem-vindo(a), {user.first_name or user.username}!")
            return redirect("dashboard")
    else:
        form = RegisterForm()

    return render(request, "finance/register.html", {"form": form})


def logout_view(request):
    """Logout simples (aceita GET para permitir um link direto na navbar)."""
    auth_login_out(request)
    return redirect("login")


# ---------------------------------------------------------------------------
# Helpers internos (período de filtro e agrupamentos)
# ---------------------------------------------------------------------------


def _resolver_periodo(request):
    """Lê os parâmetros de período da querystring e devolve (period, inicio, fim).

    `inicio`/`fim` podem ser `None` quando period == "tudo" (sem filtro de data).
    O mês atual vai até o último dia do mês, para incluir parcelas e fixos
    ainda previstos.
    """
    period = request.GET.get("period") or "mes_atual"
    hoje = timezone.localdate()

    if period == "30_dias":
        inicio, fim = hoje - timedelta(days=29), hoje
    elif period == "mes_anterior":
        inicio = add_months(first_of_month(hoje), -1)
        fim = last_of_month(inicio)
    elif period == "ano_atual":
        inicio, fim = date(hoje.year, 1, 1), date(hoje.year, 12, 31)
    elif period == "tudo":
        inicio, fim = None, None
    elif period == "personalizado":
        inicio = parse_date(request.GET.get("start_date") or "") or first_of_month(hoje)
        fim = parse_date(request.GET.get("end_date") or "") or hoje
    else:
        period = "mes_atual"
        inicio, fim = first_of_month(hoje), last_of_month(hoje)

    return period, inicio, fim


def _soma(qs) -> Decimal:
    return qs.aggregate(t=Sum("value"))["t"] or Decimal("0.00")


def _agrupar(qs, campo, vazio, icone_padrao="❔"):
    """Agrupa lançamentos por um relacionamento (categoria, forma, cartão...).

    Devolve linhas com nome, ícone, cor, total e percentual, prontas para
    tabela e gráfico.
    """
    valores = [f"{campo}__name", f"{campo}__color", f"{campo}__icon"]
    if campo in ("payment_method",):
        valores.remove(f"{campo}__color")
    if campo in ("card",):
        valores.remove(f"{campo}__icon")
    itens = list(qs.values(f"{campo}__id", *valores).annotate(total=Sum("value")).order_by("-total"))
    total_geral = sum((i["total"] for i in itens), Decimal("0.00"))
    paleta = ["#d4ff3f", "#4fd4ff", "#ff4fd4", "#ffb84f", "#4fff88", "#a04fff", "#ff6b6b", "#a0a0a0"]

    linhas = []
    for n, item in enumerate(itens):
        linhas.append(
            {
                "nome": item.get(f"{campo}__name") or vazio,
                "icone": item.get(f"{campo}__icon") or icone_padrao,
                "cor": item.get(f"{campo}__color") or paleta[n % len(paleta)],
                "total": item["total"],
                "percentual": round(item["total"] / total_geral * 100, 1) if total_geral else 0,
            }
        )
    return linhas


def _dados_grafico(linhas):
    return {
        "labels": [l["nome"] for l in linhas],
        "valores": [float(l["total"]) for l in linhas],
        "cores": [l["cor"] for l in linhas],
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@login_required
def dashboard_view(request):
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    cofrinhos = SavingsBox.objects.filter(user=request.user)[:8]
    ultimos_lancamentos = Transaction.objects.filter(user=request.user, applied=True).select_related(
        "category", "income_type", "installment_plan"
    )[:8]

    hoje = timezone.localdate()
    inicio_mes = hoje.replace(day=1)
    lancamentos_mes = Transaction.objects.filter(user=request.user, date__gte=inicio_mes, date__lte=hoje)
    total_entradas_mes = _soma(lancamentos_mes.filter(type=Transaction.INCOME))
    total_gastos_mes = _soma(lancamentos_mes.filter(type=Transaction.EXPENSE))
    total_guardado = SavingsBox.objects.filter(user=request.user).aggregate(t=Sum("amount"))["t"] or 0
    a_pagar_mes = _soma(
        Transaction.objects.filter(
            user=request.user, type=Transaction.EXPENSE, applied=False, date__lte=last_of_month(hoje)
        )
    )

    context = {
        "wallet": wallet,
        "cofrinhos": cofrinhos,
        "ultimos_lancamentos": ultimos_lancamentos,
        "total_entradas_mes": total_entradas_mes,
        "total_gastos_mes": total_gastos_mes,
        "total_guardado": total_guardado,
        "a_pagar_mes": a_pagar_mes,
    }
    return render(request, "finance/dashboard.html", context)


# ---------------------------------------------------------------------------
# Gastos e Entradas (Transaction)
# ---------------------------------------------------------------------------


def _transaction_list(request, tx_type):
    """Lista + filtros (compartilhado entre gastos e entradas)."""
    filtro = PeriodFilterForm(request.GET or None, user=request.user)
    period, inicio, fim = _resolver_periodo(request)

    qs = Transaction.objects.filter(user=request.user, type=tx_type).select_related(
        "category", "income_type", "payment_method", "card", "installment_plan"
    )
    if inicio and fim:
        qs = qs.filter(date__gte=inicio, date__lte=fim)

    # Filtro principal: categoria (gastos) ou tipo de entrada (entradas)
    if tx_type == Transaction.EXPENSE:
        filtro_param = "category"
        filtro_opcoes = Category.objects.filter(categorias_disponiveis_para(request.user))
        modalidades = Transaction.KIND_CHOICES
    else:
        filtro_param = "income_type"
        filtro_opcoes = IncomeType.objects.filter(user=request.user)
        modalidades = [(Transaction.AVISTA, "Única"), (Transaction.FIXO, "Fixa")]

    filtro_valor = request.GET.get(filtro_param) or ""
    if filtro_valor.isdigit():
        qs = qs.filter(**{f"{filtro_param}_id": filtro_valor})

    kind = request.GET.get("kind") or ""
    if kind in dict(Transaction.KIND_CHOICES):
        qs = qs.filter(kind=kind)

    context = {
        "lancamentos": qs,
        "filtro": filtro,
        "period": period,
        "total": _soma(qs),
        "total_previsto": _soma(qs.filter(applied=False)),
        "tx_type": tx_type,
        "periodos": PeriodFilterForm.PERIODO_CHOICES,
        "filtro_param": filtro_param,
        "filtro_valor": filtro_valor,
        "filtro_opcoes": filtro_opcoes,
        "modalidades": modalidades,
        "kind": kind,
    }
    return context


@login_required
def expense_list_view(request):
    context = _transaction_list(request, Transaction.EXPENSE)
    return render(request, "finance/expense_list.html", context)


@login_required
def income_list_view(request):
    context = _transaction_list(request, Transaction.INCOME)
    return render(request, "finance/income_list.html", context)


def _contexto_formulario(request, form, tx_type, **extra):
    """Dados extras para o JS do formulário (quais formas pedem cartão)."""
    formas = PaymentMethod.objects.filter(user=request.user)
    return {
        "form": form,
        "tx_type": tx_type,
        "formas_cartao": [f.pk for f in formas if f.uses_card],
        "tem_cartoes": Card.objects.filter(user=request.user).exists(),
        **extra,
    }


def _avisar_limite(request, card):
    if card and card.limit:
        resumo = resumo_cartao(card)
        if resumo["disponivel"] < 0:
            messages.warning(
                request,
                f'Atenção: o cartão "{card.name}" passou do limite em R$ {-resumo["disponivel"]:.2f}.',
            )


def _transaction_create(request, tx_type):
    """Cria gasto/entrada à vista, parcelado ou fixo mensal."""
    destino = "expense_list" if tx_type == Transaction.EXPENSE else "income_list"

    if request.method == "POST":
        form = LancamentoForm(request.POST, user=request.user, tx_type=tx_type)
        if form.is_valid():
            dados = form.cleaned_data
            comuns = {
                "user": request.user,
                "description": dados["description"],
                "category": dados.get("category"),
                "payment_method": dados.get("payment_method"),
                "card": dados.get("card"),
            }
            kind = dados["kind"]

            if kind == Transaction.PARCELADO:
                plano = InstallmentPlan.objects.create(
                    total_value=dados["value"],
                    installments=dados["installments"],
                    first_date=dados["date"],
                    **comuns,
                )
                criar_parcelas(plano)
                messages.success(
                    request,
                    f'Compra parcelada em {plano.installments}x de R$ {plano.total_value / plano.installments:.2f} registrada!',
                )
            elif kind == Transaction.FIXO:
                Recurrence.objects.create(
                    type=tx_type,
                    value=dados["value"],
                    income_type=dados.get("income_type"),
                    day_of_month=dados["date"].day,
                    start_date=dados["date"],
                    end_date=dados.get("end_date"),
                    **comuns,
                )
                gerar_recorrencias(request.user)
                aplicar_previstos(request.user)
                rotulo = "Gasto fixo" if tx_type == Transaction.EXPENSE else "Entrada fixa"
                messages.success(request, f"{rotulo} cadastrado(a)! Ele(a) será lançado(a) todo dia {dados['date'].day}.")
            else:
                tx = Transaction(
                    type=tx_type,
                    kind=Transaction.AVISTA,
                    value=dados["value"],
                    date=dados["date"],
                    income_type=dados.get("income_type"),
                    **comuns,
                )
                salvar_lancamento(tx)
                rotulo = "Gasto" if tx_type == Transaction.EXPENSE else "Entrada"
                messages.success(request, f"{rotulo} salvo(a) com sucesso!")

            _avisar_limite(request, comuns["card"])
            wallet, _ = Wallet.objects.get_or_create(user=request.user)
            if wallet.balance < 0:
                messages.warning(request, "Atenção: seu saldo ficou negativo.")
            return redirect(destino)
    else:
        form = LancamentoForm(user=request.user, tx_type=tx_type, initial={"date": timezone.localdate()})

    template = "finance/expense_form.html" if tx_type == Transaction.EXPENSE else "finance/income_form.html"
    return render(request, template, _contexto_formulario(request, form, tx_type, editando=False))


def _transaction_update(request, tx_type, pk):
    """Edita um único lançamento (inclusive uma parcela ou um mês de um fixo)."""
    instance = get_object_or_404(Transaction, pk=pk, user=request.user, type=tx_type)
    efeito_anterior = efeito_no_saldo(instance)
    destino = "expense_list" if tx_type == Transaction.EXPENSE else "income_list"

    if request.method == "POST":
        form = TransactionEditForm(request.POST, instance=instance, user=request.user)
        if form.is_valid():
            tx = form.save(commit=False)
            wallet = salvar_lancamento(tx, efeito_anterior)
            _avisar_limite(request, tx.card)
            if wallet.balance < 0:
                messages.warning(request, "Atenção: seu saldo ficou negativo.")
            messages.success(request, "Lançamento atualizado!")
            return redirect(destino)
    else:
        form = TransactionEditForm(instance=instance, user=request.user)

    template = "finance/expense_form.html" if tx_type == Transaction.EXPENSE else "finance/income_form.html"
    return render(
        request, template, _contexto_formulario(request, form, tx_type, editando=True, lancamento=instance)
    )


@login_required
def expense_create_view(request):
    return _transaction_create(request, Transaction.EXPENSE)


@login_required
def expense_update_view(request, pk):
    return _transaction_update(request, Transaction.EXPENSE, pk=pk)


@login_required
def income_create_view(request):
    return _transaction_create(request, Transaction.INCOME)


@login_required
def income_update_view(request, pk):
    return _transaction_update(request, Transaction.INCOME, pk=pk)


@login_required
def transaction_delete_view(request, pk):
    """Exclui um lançamento (ou o parcelamento inteiro) e devolve o efeito no saldo."""
    transacao = get_object_or_404(Transaction, pk=pk, user=request.user)
    destino = "expense_list" if transacao.type == Transaction.EXPENSE else "income_list"

    if request.method == "POST":
        plano = transacao.installment_plan
        if plano and request.POST.get("escopo") == "plano":
            excluir_lancamentos(request.user, plano.transactions.all())
            plano.delete()
            messages.success(request, "Parcelamento inteiro excluído.")
        else:
            excluir_lancamentos(request.user, Transaction.objects.filter(pk=transacao.pk))
            messages.success(request, "Lançamento excluído.")
        return redirect(destino)

    return render(request, "finance/transaction_confirm_delete.html", {"transacao": transacao, "destino": destino})


# ---------------------------------------------------------------------------
# Finanças: visão de compromissos, cartões e projeção
# ---------------------------------------------------------------------------


@login_required
def finance_view(request):
    user = request.user
    hoje = timezone.localdate()
    inicio_mes, fim_mes = first_of_month(hoje), last_of_month(hoje)
    wallet, _ = Wallet.objects.get_or_create(user=user)

    mes = Transaction.objects.filter(user=user, date__gte=inicio_mes, date__lte=fim_mes)
    entradas_mes = _soma(mes.filter(type=Transaction.INCOME))
    gastos_mes = _soma(mes.filter(type=Transaction.EXPENSE))
    previsto_entrar = _soma(mes.filter(type=Transaction.INCOME, applied=False))
    previsto_sair = _soma(mes.filter(type=Transaction.EXPENSE, applied=False))
    saldo_projetado = wallet.balance + previsto_entrar - previsto_sair

    recorrencias = Recurrence.objects.filter(user=user).select_related(
        "category", "income_type", "payment_method", "card"
    )
    gastos_fixos = [r for r in recorrencias if r.type == Transaction.EXPENSE]
    entradas_fixas = [r for r in recorrencias if r.type == Transaction.INCOME]
    total_gastos_fixos = sum((r.value for r in gastos_fixos if r.active), Decimal("0.00"))
    total_entradas_fixas = sum((r.value for r in entradas_fixas if r.active), Decimal("0.00"))
    comprometimento = (
        round(total_gastos_fixos / total_entradas_fixas * 100, 1) if total_entradas_fixas else None
    )

    parcelamentos = (
        InstallmentPlan.objects.filter(user=user)
        .select_related("card", "category")
        .annotate(
            pagas=Count("transactions", filter=Q(transactions__applied=True)),
            restante=Sum("transactions__value", filter=Q(transactions__applied=False)),
            ultima=Max("transactions__date"),
        )
        .order_by("ultima")
    )
    parcelamentos_ativos = [p for p in parcelamentos if p.restante]
    parcelamentos_quitados = [p for p in parcelamentos if not p.restante]
    total_parcelas_restantes = sum((p.restante for p in parcelamentos_ativos), Decimal("0.00"))

    cartoes = [resumo_cartao(c) for c in Card.objects.filter(user=user)]

    projecao = projecao_meses(user, 6)
    acumulado = saldo_projetado
    for linha in projecao:
        acumulado += linha["resultado"]
        linha["saldo"] = acumulado

    limite_proximos = hoje + timedelta(days=30)
    proximos = list(
        Transaction.objects.filter(user=user, applied=False, date__lte=limite_proximos)
        .select_related("category", "income_type", "card", "installment_plan")
    )
    proximos += ocorrencias_futuras(user, limite_proximos)
    proximos = sorted(proximos, key=lambda tx: tx.date)[:20]

    # Média de gastos dos 3 meses anteriores, para comparar com o mês atual
    inicio_tri = add_months(inicio_mes, -3)
    gastos_tri = _soma(
        Transaction.objects.filter(
            user=user, type=Transaction.EXPENSE, date__gte=inicio_tri, date__lt=inicio_mes
        )
    )
    media_gastos = gastos_tri / 3

    dicas = []
    if saldo_projetado < 0:
        dicas.append(("alerta", f"Pelo previsto, seu saldo deve fechar o mês negativo (R$ {saldo_projetado:.2f})."))
    if comprometimento is not None and comprometimento > 50:
        dicas.append(("alerta", f"Seus gastos fixos consomem {comprometimento}% das suas entradas fixas. O recomendado é ficar abaixo de 50%."))
    for c in cartoes:
        if c["disponivel"] is not None and c["disponivel"] < 0:
            dicas.append(("alerta", f'O cartão "{c["card"].name}" passou do limite em R$ {-c["disponivel"]:.2f} (contando as parcelas futuras).'))
        elif c["percentual"] is not None and c["percentual"] >= 80:
            dicas.append(("alerta", f'O cartão "{c["card"].name}" está com {c["percentual"]}% do limite comprometido.'))
    if media_gastos and gastos_mes > media_gastos * Decimal("1.2"):
        dicas.append(("info", f"Seus gastos deste mês estão {round((gastos_mes / media_gastos - 1) * 100)}% acima da média dos últimos 3 meses."))
    if not entradas_fixas:
        dicas.append(("info", "Cadastre suas entradas fixas (ex: salário) para ver o quanto da renda está comprometida."))
    if not dicas:
        dicas.append(("ok", "Tudo em dia! Nenhum alerta para este mês."))

    context = {
        "wallet": wallet,
        "hoje": hoje,
        "entradas_mes": entradas_mes,
        "gastos_mes": gastos_mes,
        "previsto_entrar": previsto_entrar,
        "previsto_sair": previsto_sair,
        "saldo_projetado": saldo_projetado,
        "gastos_fixos": gastos_fixos,
        "entradas_fixas": entradas_fixas,
        "total_gastos_fixos": total_gastos_fixos,
        "total_entradas_fixas": total_entradas_fixas,
        "comprometimento": comprometimento,
        "parcelamentos_ativos": parcelamentos_ativos,
        "parcelamentos_quitados": parcelamentos_quitados,
        "total_parcelas_restantes": total_parcelas_restantes,
        "cartoes": cartoes,
        "projecao": projecao,
        "proximos": proximos,
        "dicas": dicas,
        "chart_projecao": {
            "labels": [date_format(l["mes"], "M/y") for l in projecao],
            "entradas": [float(l["entradas"]) for l in projecao],
            "saidas": [float(l["saidas"]) for l in projecao],
            "saldo": [float(l["saldo"]) for l in projecao],
        },
    }
    return render(request, "finance/finance.html", context)


@login_required
def recurrence_update_view(request, pk):
    recorrencia = get_object_or_404(Recurrence, pk=pk, user=request.user)
    if request.method == "POST":
        form = RecurrenceForm(request.POST, instance=recorrencia, user=request.user)
        if form.is_valid():
            rec = form.save()
            if not rec.active:
                # Pausado: remove o lançamento previsto ainda não pago deste mês
                rec.transactions.filter(applied=False).delete()
            messages.success(request, "Lançamento fixo atualizado! As mudanças valem para os próximos meses.")
            return redirect("finance")
    else:
        form = RecurrenceForm(instance=recorrencia, user=request.user)
    return render(
        request,
        "finance/recurrence_form.html",
        _contexto_formulario(request, form, recorrencia.type, recorrencia=recorrencia),
    )


@login_required
def recurrence_delete_view(request, pk):
    """Exclui o fixo. Lançamentos já pagos ficam no histórico; os previstos somem."""
    recorrencia = get_object_or_404(Recurrence, pk=pk, user=request.user)
    if request.method == "POST":
        recorrencia.transactions.filter(applied=False).delete()
        recorrencia.delete()
        messages.success(request, "Lançamento fixo excluído. O histórico já lançado foi mantido.")
        return redirect("finance")
    return render(
        request,
        "finance/confirm_delete.html",
        {
            "titulo": "Excluir lançamento fixo",
            "nome": recorrencia.description or "Lançamento fixo",
            "detalhe": f"R$ {recorrencia.value:.2f} todo dia {recorrencia.day_of_month}. "
                       "Os meses já lançados continuam no histórico; os previstos serão removidos.",
            "url_cancelar": reverse("finance"),
        },
    )


@login_required
def installment_plan_update_view(request, pk):
    plano = get_object_or_404(InstallmentPlan, pk=pk, user=request.user)
    if request.method == "POST":
        form = InstallmentPlanForm(request.POST, instance=plano, user=request.user)
        if form.is_valid():
            plano = form.save()
            plano.transactions.update(
                description=plano.description,
                category=plano.category,
                payment_method=plano.payment_method,
                card=plano.card,
            )
            messages.success(request, "Parcelamento atualizado em todas as parcelas.")
            return redirect("finance")
    else:
        form = InstallmentPlanForm(instance=plano, user=request.user)
    parcelas = plano.transactions.order_by("installment_number")
    return render(
        request,
        "finance/installment_plan_form.html",
        _contexto_formulario(request, form, Transaction.EXPENSE, plano=plano, parcelas=parcelas),
    )


@login_required
def installment_plan_delete_view(request, pk):
    plano = get_object_or_404(InstallmentPlan, pk=pk, user=request.user)
    if request.method == "POST":
        excluir_lancamentos(request.user, plano.transactions.all())
        plano.delete()
        messages.success(request, "Parcelamento excluído. As parcelas já pagas voltaram para o saldo.")
        return redirect("finance")
    return render(
        request,
        "finance/confirm_delete.html",
        {
            "titulo": "Excluir parcelamento",
            "nome": plano.description or "Parcelamento",
            "detalhe": f"{plano.installments}x — total de R$ {plano.total_value:.2f}. "
                       "Todas as parcelas serão excluídas e as já pagas voltam para o saldo.",
            "url_cancelar": reverse("finance"),
        },
    )


# ---------------------------------------------------------------------------
# Cofrinhos (SavingsBox)
# ---------------------------------------------------------------------------


@login_required
def savingsbox_list_view(request):
    cofrinhos = SavingsBox.objects.filter(user=request.user)
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    return render(request, "finance/savingsbox_list.html", {"cofrinhos": cofrinhos, "wallet": wallet})


@login_required
def savingsbox_create_view(request):
    if request.method == "POST":
        form = SavingsBoxForm(request.POST)
        if form.is_valid():
            cofrinho = form.save(commit=False)
            cofrinho.user = request.user
            cofrinho.save()
            messages.success(request, f'Cofrinho "{cofrinho.name}" criado!')
            return redirect("savingsbox_list")
    else:
        form = SavingsBoxForm()
    return render(request, "finance/savingsbox_form.html", {"form": form, "editando": False})


@login_required
def savingsbox_update_view(request, pk):
    cofrinho = get_object_or_404(SavingsBox, pk=pk, user=request.user)
    if request.method == "POST":
        form = SavingsBoxForm(request.POST, instance=cofrinho)
        if form.is_valid():
            cofrinho = form.save(commit=False)
            if "goal" in form.changed_data:
                cofrinho.goal_alert_dismissed = False  # meta nova, aviso novo
            cofrinho.save()
            messages.success(request, "Cofrinho atualizado!")
            return redirect("savingsbox_list")
    else:
        form = SavingsBoxForm(instance=cofrinho)
    return render(request, "finance/savingsbox_form.html", {"form": form, "editando": True, "cofrinho": cofrinho})


@login_required
def savingsbox_delete_view(request, pk):
    """Exclui o cofrinho e devolve o valor guardado para o saldo principal."""
    cofrinho = get_object_or_404(SavingsBox, pk=pk, user=request.user)
    if request.method == "POST":
        ajustar_saldo(request.user, cofrinho.amount)
        nome = cofrinho.name
        cofrinho.delete()
        messages.success(request, f'Cofrinho "{nome}" excluído. O valor guardado voltou para o seu saldo.')
        return redirect("savingsbox_list")
    return render(request, "finance/savingsbox_confirm_delete.html", {"cofrinho": cofrinho})


@login_required
def savingsbox_dismiss_alert_view(request, pk):
    """Dispensa o aviso de "meta atingida" do cofrinho (botão ✕ da faixa do topo)."""
    if request.method != "POST":
        return redirect("savingsbox_list")
    SavingsBox.objects.filter(pk=pk, user=request.user).update(goal_alert_dismissed=True)
    return HttpResponse(status=204)


@login_required
def savingsbox_deposit_view(request, pk):
    """Deposita dinheiro no cofrinho: debita do saldo principal, credita no cofrinho."""
    cofrinho = get_object_or_404(SavingsBox, pk=pk, user=request.user)
    wallet, _ = Wallet.objects.get_or_create(user=request.user)

    if request.method == "POST":
        form = SavingsMovementForm(request.POST)
        if form.is_valid():
            valor = form.cleaned_data["value"]
            if valor > wallet.balance:
                messages.error(request, "Saldo insuficiente para esse depósito.")
            else:
                ajustar_saldo(request.user, -valor)
                cofrinho.amount += valor
                cofrinho.save(update_fields=["amount"])
                SavingsMovement.objects.create(savings_box=cofrinho, type=SavingsMovement.DEPOSIT, value=valor)
                messages.success(request, f"R$ {valor} guardado(s) em \"{cofrinho.name}\".")
                return redirect("savingsbox_list")
    else:
        form = SavingsMovementForm()

    context = {"form": form, "cofrinho": cofrinho, "wallet": wallet, "acao": "deposit"}
    return render(request, "finance/savingsbox_movement.html", context)


@login_required
def savingsbox_withdraw_view(request, pk):
    """Resgata dinheiro do cofrinho de volta para o saldo principal."""
    cofrinho = get_object_or_404(SavingsBox, pk=pk, user=request.user)
    wallet, _ = Wallet.objects.get_or_create(user=request.user)

    if request.method == "POST":
        form = SavingsMovementForm(request.POST)
        if form.is_valid():
            valor = form.cleaned_data["value"]
            if valor > cofrinho.amount:
                messages.error(request, "O cofrinho não tem esse valor guardado.")
            else:
                cofrinho.amount -= valor
                if not cofrinho.goal_reached:
                    cofrinho.goal_alert_dismissed = False  # se atingir de novo, avisa de novo
                cofrinho.save(update_fields=["amount", "goal_alert_dismissed"])
                ajustar_saldo(request.user, valor)
                SavingsMovement.objects.create(savings_box=cofrinho, type=SavingsMovement.WITHDRAW, value=valor)
                messages.success(request, f"R$ {valor} resgatado(s) de \"{cofrinho.name}\".")
                return redirect("savingsbox_list")
    else:
        form = SavingsMovementForm()

    context = {"form": form, "cofrinho": cofrinho, "wallet": wallet, "acao": "withdraw"}
    return render(request, "finance/savingsbox_movement.html", context)


# ---------------------------------------------------------------------------
# Configurações: aparência, categorias, formas de pagamento, cartões e tipos
# de entrada — todos com o mesmo CRUD genérico.
# ---------------------------------------------------------------------------

CONFIG_ABAS = {
    "aparencia": {"titulo": "Aparência"},
    "categorias": {
        "titulo": "Categorias",
        "singular": "categoria",
        "descricao": "Categorias dos seus gastos. As padrão do sistema não podem ser editadas.",
        "model": Category,
        "form": CategoryForm,
        "dica": "Use um emoji como ícone, ex: 🍔 🚌 🎬 🏠 💊 📚",
    },
    "pagamento": {
        "titulo": "Formas de pagamento",
        "singular": "forma de pagamento",
        "descricao": "Como você paga seus gastos. Formas do tipo cartão perguntam qual cartão foi usado.",
        "model": PaymentMethod,
        "form": PaymentMethodForm,
    },
    "cartoes": {
        "titulo": "Cartões",
        "singular": "cartão",
        "descricao": "Seus cartões, com limite e datas de fechamento/vencimento da fatura.",
        "model": Card,
        "form": CardForm,
        "dica": "Compras feitas depois do dia de fechamento entram na fatura seguinte.",
    },
    "entradas": {
        "titulo": "Tipos de entrada",
        "singular": "tipo de entrada",
        "descricao": "De onde vem seu dinheiro: salário, freelance, investimentos...",
        "model": IncomeType,
        "form": IncomeTypeForm,
    },
}


def _config_aba(aba):
    if aba not in CONFIG_ABAS:
        raise Http404("Aba de configuração inexistente.")
    return CONFIG_ABAS[aba]


def _config_editavel(request, aba, pk):
    """Busca um item editável pelo usuário (categorias padrão não são)."""
    model = _config_aba(aba)["model"]
    filtros = {"pk": pk, "user": request.user}
    if model is Category:
        filtros["is_default"] = False
    return get_object_or_404(model, **filtros)


@login_required
def settings_view(request, aba="aparencia"):
    config = _config_aba(aba)
    itens = []
    if aba == "categorias":
        itens = Category.objects.filter(categorias_disponiveis_para(request.user))
    elif aba == "cartoes":
        itens = [resumo_cartao(c) for c in Card.objects.filter(user=request.user)]
    elif "model" in config:
        itens = config["model"].objects.filter(user=request.user)

    context = {
        "aba": aba,
        "config": config,
        "abas": [(chave, dados["titulo"]) for chave, dados in CONFIG_ABAS.items()],
        "itens": itens,
    }
    return render(request, "finance/settings.html", context)


@login_required
def settings_item_save_view(request, aba, pk=None):
    config = _config_aba(aba)
    if "form" not in config:
        raise Http404
    instance = _config_editavel(request, aba, pk) if pk else None

    if request.method == "POST":
        form = config["form"](request.POST, instance=instance)
        if form.is_valid():
            item = form.save(commit=False)
            item.user = request.user
            if isinstance(item, Category):
                item.is_default = False
            item.save()
            messages.success(request, f"{config['singular'].capitalize()} salvo(a)!")
            return redirect("settings", aba=aba)
    else:
        form = config["form"](instance=instance)

    context = {"form": form, "config": config, "aba": aba, "editando": instance is not None}
    return render(request, "finance/settings_form.html", context)


@login_required
def settings_item_delete_view(request, aba, pk):
    config = _config_aba(aba)
    item = _config_editavel(request, aba, pk)
    if request.method == "POST":
        item.delete()
        messages.success(request, f"{config['singular'].capitalize()} excluído(a).")
        return redirect("settings", aba=aba)
    return render(
        request,
        "finance/confirm_delete.html",
        {
            "titulo": f"Excluir {config['singular']}",
            "nome": str(item),
            "detalhe": "Os lançamentos que usam este item não serão apagados — só ficarão sem ele.",
            "url_cancelar": reverse("settings", args=[aba]),
        },
    )


# ---------------------------------------------------------------------------
# Relatórios (agregação por período, direto do banco)
# ---------------------------------------------------------------------------


@login_required
def reports_view(request):
    """Relatório consolidado do período: totais, categorias, modalidades
    (à vista / parcelado / fixo), formas de pagamento, cartões, tipos de
    entrada, evolução mensal e lista de fixos ativos.

    Usa `values(...).annotate(Sum(...))` para agregar tudo no banco de dados.
    """
    filtro = PeriodFilterForm(request.GET or None, user=request.user)
    period, inicio, fim = _resolver_periodo(request)

    lancamentos = Transaction.objects.filter(user=request.user)
    if inicio and fim:
        lancamentos = lancamentos.filter(date__gte=inicio, date__lte=fim)
    gastos = lancamentos.filter(type=Transaction.EXPENSE)
    entradas = lancamentos.filter(type=Transaction.INCOME)

    total_gastos = _soma(gastos)
    total_entradas = _soma(entradas)

    por_categoria = _agrupar(gastos, "category", "Sem categoria")

    rotulos_modalidade = dict(Transaction.KIND_CHOICES)
    cores_modalidade = {Transaction.AVISTA: "#4fd4ff", Transaction.PARCELADO: "#ffb84f", Transaction.FIXO: "#ff4fd4"}
    por_modalidade = []
    for item in gastos.values("kind").annotate(total=Sum("value"), qtd=Count("id")).order_by("-total"):
        por_modalidade.append(
            {
                "nome": rotulos_modalidade.get(item["kind"], item["kind"]),
                "cor": cores_modalidade.get(item["kind"], "#a0a0a0"),
                "total": item["total"],
                "qtd": item["qtd"],
                "percentual": round(item["total"] / total_gastos * 100, 1) if total_gastos else 0,
            }
        )

    # Evolução mensal: os 6 meses que terminam no fim do período (ou hoje)
    referencia = first_of_month(fim or timezone.localdate())
    inicio_evolucao = add_months(referencia, -5)
    meses = [add_months(inicio_evolucao, i) for i in range(6)]
    agregados = (
        Transaction.objects.filter(
            user=request.user, date__gte=inicio_evolucao, date__lte=last_of_month(referencia)
        )
        .annotate(mes=TruncMonth("date"))
        .values("mes", "type")
        .annotate(total=Sum("value"))
    )
    por_mes = {(a["mes"], a["type"]): float(a["total"]) for a in agregados}

    fixos_ativos = Recurrence.objects.filter(user=request.user, active=True).select_related(
        "category", "income_type", "card"
    )

    context = {
        "filtro": filtro,
        "period": period,
        "periodos": PeriodFilterForm.PERIODO_CHOICES,
        "inicio": inicio,
        "fim": fim,
        "total_gastos": total_gastos,
        "total_entradas": total_entradas,
        "resultado": total_entradas - total_gastos,
        "total_fixos": _soma(gastos.filter(kind=Transaction.FIXO)),
        "total_parcelado": _soma(gastos.filter(kind=Transaction.PARCELADO)),
        "previsto_gastos": _soma(gastos.filter(applied=False)),
        "linhas": por_categoria,
        "por_modalidade": por_modalidade,
        "por_forma": _agrupar(gastos, "payment_method", "Não informada", "💳"),
        "por_cartao": _agrupar(gastos.filter(card__isnull=False), "card", "Cartão", "💳"),
        "por_tipo_entrada": _agrupar(entradas, "income_type", "Sem tipo", "💵"),
        "gastos_fixos": [r for r in fixos_ativos if r.type == Transaction.EXPENSE],
        "entradas_fixas": [r for r in fixos_ativos if r.type == Transaction.INCOME],
        "total_mensal_fixos": sum(
            (r.value for r in fixos_ativos if r.type == Transaction.EXPENSE), Decimal("0.00")
        ),
        "chart_categorias": _dados_grafico(por_categoria),
        "chart_modalidade": _dados_grafico(por_modalidade),
        "chart_evolucao": {
            "labels": [date_format(m, "M/y") for m in meses],
            "entradas": [por_mes.get((m, Transaction.INCOME), 0) for m in meses],
            "gastos": [por_mes.get((m, Transaction.EXPENSE), 0) for m in meses],
        },
    }
    return render(request, "finance/reports.html", context)
