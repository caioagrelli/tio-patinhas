"""
Context processor que injeta alertas financeiros em todas as páginas,
exibidos na faixa de destaque (verde-limão/neon) no topo do layout.

Regra implementada: avisa quando algum cofrinho do usuário atingiu a meta.
Fácil de estender com outras regras no futuro (ex: gasto do mês acima da média).
"""

from django.db.models import F

from .models import SavingsBox


def alertas_financeiros(request):
    """Retorna, para todo template, `alerta_topo` (str ou None) e o
    `alerta_cofrinho_id` usado pelo botão de fechar para dispensar o aviso."""
    alerta = None
    cofrinho_id = None

    if request.user.is_authenticated:
        cofrinho = (
            SavingsBox.objects.filter(user=request.user, goal__isnull=False, goal_alert_dismissed=False)
            .filter(amount__gte=F("goal"))
            .first()
        )
        if cofrinho:
            alerta = f'🎉 Meta do cofrinho "{cofrinho.name}" atingida!'
            cofrinho_id = cofrinho.pk

    return {"alerta_topo": alerta, "alerta_cofrinho_id": cofrinho_id}


# Itens do menu principal: (rótulo, nome da URL, prefixo de url_name que marca o item ativo)
MENU = [
    ("Dashboard", "dashboard", ("dashboard",)),
    ("Gastos", "expense_list", ("expense_",)),
    ("Entradas", "income_list", ("income_",)),
    ("Finanças", "finance", ("finance", "recurrence_", "installment_plan_")),
    ("Cofrinhos", "savingsbox_list", ("savingsbox_",)),
    ("Relatórios", "reports", ("reports",)),
]


def menu(request):
    """Menu principal com o item ativo já marcado."""
    url_name = getattr(request.resolver_match, "url_name", "") or ""
    itens = [
        {"rotulo": rotulo, "url": url, "ativo": url_name.startswith(prefixos)}
        for rotulo, url, prefixos in MENU
    ]
    config_ativo = url_name.startswith(("settings", "category_"))
    return {"menu_itens": itens, "menu_config_ativo": config_ativo}
