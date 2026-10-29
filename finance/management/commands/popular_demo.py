"""
Preenche uma conta de demonstração com ~6 meses de dados realistas.

    python manage.py popular_demo                 # usuário "demo" / senha "Demo!12345x"
    python manage.py popular_demo --usuario ana   # outro usuário (criado se não existir)

ATENÇÃO: apaga todos os lançamentos, cofrinhos, cartões e cadastros do
usuário escolhido antes de popular.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from finance.defaults import FORMAS_PAGAMENTO_PADRAO, TIPOS_ENTRADA_PADRAO
from finance.models import (
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
from finance.services import add_months, ajustar_saldo, criar_parcelas, first_of_month, processar_lancamentos, salvar_lancamento


class Command(BaseCommand):
    help = "Apaga e repopula uma conta de demonstração com dados realistas."

    def add_arguments(self, parser):
        parser.add_argument("--usuario", default="demo")
        parser.add_argument("--senha", default="Demo!12345x")

    @transaction.atomic
    def handle(self, *args, usuario, senha, **options):
        random.seed(42)
        user, criado = User.objects.get_or_create(username=usuario, defaults={"first_name": usuario.capitalize()})
        if criado:
            user.set_password(senha)
            user.save()

        self._limpar(user)
        hoje = timezone.localdate()
        inicio = add_months(first_of_month(hoje), -5)  # 6 meses de histórico

        # --- Cadastros ---------------------------------------------------------
        cat = {c.name: c for c in Category.objects.filter(is_default=True)}
        cat["Assinaturas"] = Category.objects.create(user=user, name="Assinaturas", icon="📺", color="#ff6b6b")
        cat["Pets"] = Category.objects.create(user=user, name="Pets", icon="🐶", color="#c8a2ff")
        cat["Mercado"] = Category.objects.create(user=user, name="Mercado", icon="🛒", color="#7cffc4")

        forma = {k: PaymentMethod.objects.get(user=user, kind=k) for k in ("dinheiro", "pix", "debito", "credito", "boleto")}
        forma["vr"] = PaymentMethod.objects.create(user=user, name="Vale-refeição", kind="outro", icon="🍽️")

        nubank = Card.objects.create(user=user, name="Nubank", limit=Decimal("12000"), closing_day=3, due_day=10, color="#8a05be")
        inter = Card.objects.create(user=user, name="Inter", limit=Decimal("2500"), closing_day=25, due_day=5, color="#ff7a00")
        c6 = Card.objects.create(user=user, name="C6 Débito", color="#9ca3af")

        tipo = {t.name: t for t in IncomeType.objects.filter(user=user)}
        tipo["Aluguel recebido"] = IncomeType.objects.create(user=user, name="Aluguel recebido", icon="🏘️", color="#ffb84f")

        # --- Fixos (gerados automaticamente desde o início) -------------------
        def fixo(tx_type, valor, desc, dia, **kw):
            Recurrence.objects.create(
                user=user, type=tx_type, value=Decimal(valor), description=desc,
                day_of_month=dia, start_date=add_months(inicio, 0, day=dia), **kw,
            )

        fixo("income", "6800.00", "Salário", 5, income_type=tipo["Salário"])
        fixo("income", "950.00", "Aluguel do apartamento", 10, income_type=tipo["Aluguel recebido"])
        fixo("expense", "2100.00", "Aluguel", 10, category=cat["Moradia"], payment_method=forma["boleto"])
        fixo("expense", "480.00", "Condomínio", 10, category=cat["Moradia"], payment_method=forma["boleto"])
        fixo("expense", "119.90", "Internet fibra", 15, category=cat["Moradia"], payment_method=forma["debito"], card=c6)
        fixo("expense", "89.90", "Academia", 1, category=cat["Saúde"], payment_method=forma["credito"], card=nubank)
        fixo("expense", "55.90", "Netflix", 12, category=cat["Assinaturas"], payment_method=forma["credito"], card=nubank)
        fixo("expense", "21.90", "Spotify", 18, category=cat["Assinaturas"], payment_method=forma["credito"], card=inter)
        fixo("expense", "389.00", "Plano de saúde", 20, category=cat["Saúde"], payment_method=forma["boleto"])
        fixo("expense", "150.00", "Curso de inglês", 8, category=cat["Educação"], payment_method=forma["pix"],
             end_date=add_months(hoje, 4))
        # Um fixo pausado, para ver como aparece
        Recurrence.objects.create(
            user=user, type="expense", value=Decimal("39.90"), description="Disney+ (cancelado)",
            day_of_month=22, start_date=add_months(inicio, 0, day=22), active=False,
            category=cat["Assinaturas"], payment_method=forma["credito"], card=inter,
            last_generated=add_months(inicio, 2),
        )
        processar_lancamentos(user)

        # --- Parcelamentos ----------------------------------------------------
        def parcelado(valor, n, desc, data, categoria, card):
            plano = InstallmentPlan.objects.create(
                user=user, description=desc, total_value=Decimal(valor), installments=n, first_date=data,
                category=cat[categoria], payment_method=forma["credito"], card=card,
            )
            criar_parcelas(plano)

        parcelado("4800.00", 12, "Notebook", add_months(inicio, 1, day=14), "Educação", nubank)
        parcelado("2399.00", 10, "Celular", add_months(hoje, -1, day=7), "Outros", nubank)
        parcelado("1500.00", 3, "Sofá", add_months(inicio, 0, day=20), "Moradia", inter)  # já quitado
        parcelado("3200.00", 8, "Passagens de férias", add_months(hoje, 0, day=2), "Lazer", nubank)
        parcelado("620.00", 4, "Pneus do carro", add_months(hoje, -2, day=25), "Transporte", inter)

        # --- Gastos do dia a dia (à vista) ------------------------------------
        def gasto(valor, desc, data, categoria, chave_forma, card=None):
            salvar_lancamento(Transaction(
                user=user, type="expense", kind="avista", value=Decimal(valor).quantize(Decimal("0.01")),
                description=desc, date=data, category=cat[categoria], payment_method=forma[chave_forma], card=card,
            ))

        dia = inicio
        while dia <= hoje:
            sorteio = random.random()
            if dia.weekday() == 5:  # sábado: mercado
                no_credito = random.random() < 0.5
                gasto(random.uniform(180, 420), random.choice(["Mercado", "Atacadão", "Feira"]), dia, "Mercado",
                      "credito" if no_credito else "debito", card=nubank if no_credito else c6)
            if sorteio < 0.35:
                gasto(random.uniform(14, 45), random.choice(["Uber", "99", "Ônibus/metrô"]), dia, "Transporte", "pix")
            if dia.weekday() < 5 and sorteio > 0.45:
                gasto(random.uniform(22, 48), random.choice(["Almoço", "Marmita", "Lanche"]), dia, "Alimentação", "vr")
            if dia.weekday() in (4, 5) and sorteio > 0.6:
                gasto(random.uniform(60, 220), random.choice(["Restaurante", "Bar com amigos", "Pizza", "Cinema"]),
                      dia, random.choice(["Alimentação", "Lazer"]), "credito", nubank)
            if dia.day == 6:
                gasto(random.uniform(150, 260), "Conta de luz", dia, "Moradia", "pix")
                gasto(random.uniform(70, 110), "Conta de água", dia, "Moradia", "pix")
            if dia.day == 16:
                gasto(random.uniform(180, 280), "Combustível", dia, "Transporte", "credito", inter)
            if dia.day == 21:
                gasto(random.uniform(120, 190), "Ração e petshop", dia, "Pets", "credito", nubank)
            if dia.day == 27 and sorteio > 0.5:
                gasto(random.uniform(40, 160), "Farmácia", dia, "Saúde", "debito", c6)
            dia += timedelta(days=1)

        # --- Entradas avulsas -------------------------------------------------
        salvar_lancamento(Transaction(
            user=user, type="income", kind="avista", value=Decimal("12000.00"), description="Saldo inicial",
            date=inicio, income_type=tipo["Outros"],
        ))
        for meses_atras, valor, desc in [(4, "1800.00", "Site para cliente"), (2, "950.00", "Landing page"),
                                         (0, "1200.00", "Consultoria")]:
            salvar_lancamento(Transaction(
                user=user, type="income", kind="avista", value=Decimal(valor), description=desc,
                date=min(add_months(hoje, -meses_atras, day=18), hoje), income_type=tipo["Freelance"],
            ))
        salvar_lancamento(Transaction(
            user=user, type="income", kind="avista", value=Decimal("312.45"), description="Dividendos",
            date=add_months(hoje, -1, day=15), income_type=tipo["Investimentos"],
        ))
        salvar_lancamento(Transaction(
            user=user, type="income", kind="avista", value=Decimal("300.00"), description="Presente de aniversário",
            date=add_months(hoje, -3, day=9), income_type=tipo["Presente"],
        ))

        # --- Cofrinhos --------------------------------------------------------
        for nome, icone, cor, meta, depositos in [
            ("Reserva de emergência", "🛟", "#4fd4ff", "20000", ["2000", "1500", "1500", "1000", "1000", "800"]),
            ("Viagem para o Nordeste", "🏖️", "#ffb84f", "6000", ["500", "700", "600", "800"]),
            ("Troca de celular", "📱", "#ff4fd4", "1500", ["800", "700"]),  # meta atingida
        ]:
            box = SavingsBox.objects.create(user=user, name=nome, icon=icone, color=cor, goal=Decimal(meta))
            for valor in depositos:
                valor = Decimal(valor)
                box.amount += valor
                ajustar_saldo(user, -valor)
                SavingsMovement.objects.create(savings_box=box, type=SavingsMovement.DEPOSIT, value=valor)
            box.save(update_fields=["amount"])

        wallet = Wallet.objects.get(user=user)
        self.stdout.write(self.style.SUCCESS(
            f'Conta "{usuario}" populada: {Transaction.objects.filter(user=user).count()} lançamentos, '
            f"saldo R$ {wallet.balance}. Login: {usuario} / {senha if criado else '(senha atual)'}"
        ))

    def _limpar(self, user):
        Transaction.objects.filter(user=user).delete()
        InstallmentPlan.objects.filter(user=user).delete()
        Recurrence.objects.filter(user=user).delete()
        SavingsBox.objects.filter(user=user).delete()
        Card.objects.filter(user=user).delete()
        Category.objects.filter(user=user).delete()
        PaymentMethod.objects.filter(user=user).delete()
        IncomeType.objects.filter(user=user).delete()
        PaymentMethod.objects.bulk_create(
            PaymentMethod(user=user, name=n, kind=k, icon=i) for n, k, i in FORMAS_PAGAMENTO_PADRAO
        )
        IncomeType.objects.bulk_create(
            IncomeType(user=user, name=n, icon=i, color=c) for n, i, c in TIPOS_ENTRADA_PADRAO
        )
        Wallet.objects.update_or_create(user=user, defaults={"balance": Decimal("0.00")})
