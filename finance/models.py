"""
Modelos de dados do sistema de controle financeiro pessoal.

Entidades:
    - Wallet (Carteira/Saldo): saldo principal do usuário.
    - Category (Categoria): categorias de gasto/entrada (padrão ou do usuário).
    - SavingsBox (Cofrinho): "potes" de dinheiro guardado com meta opcional.
    - SavingsMovement: histórico de depósitos/resgates em cofrinhos.
    - PaymentMethod / Card / IncomeType: cadastros configuráveis do usuário.
    - Recurrence: lançamentos fixos mensais (gerados automaticamente).
    - InstallmentPlan: compras parceladas (uma Transaction por parcela).
    - Transaction (Gasto/Entrada): lançamentos financeiros (entrada ou saída).

Todo dado é sempre vinculado a um usuário (`user`), garantindo o isolamento
por `request.user` exigido nas views.
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Wallet(models.Model):
    """Saldo principal disponível do usuário.

    É atualizado automaticamente pelas views sempre que uma transação é
    criada/editada/excluída ou quando há depósito/resgate em um cofrinho.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wallet",
        verbose_name="Usuário",
    )
    balance = models.DecimalField(
        "Saldo disponível", max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    updated_at = models.DateTimeField("Atualizado em", auto_now=True)

    class Meta:
        verbose_name = "Carteira"
        verbose_name_plural = "Carteiras"

    def __str__(self):
        return f"Carteira de {self.user.get_username()} — R$ {self.balance}"


class Category(models.Model):
    """Categoria de um gasto ou entrada (ex: Alimentação, Transporte...).

    Pode ser padrão do sistema (`is_default=True`, sem `user`) ou criada por
    um usuário específico.
    """

    name = models.CharField("Nome", max_length=60)
    color = models.CharField(
        "Cor", max_length=7, default="#d4ff3f", help_text="Código hexadecimal, ex: #d4ff3f"
    )
    icon = models.CharField(
        "Ícone", max_length=10, default="💰", help_text="Emoji usado como ícone da categoria"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="categories",
        verbose_name="Usuário",
        null=True,
        blank=True,
        help_text="Vazio quando é uma categoria padrão do sistema",
    )
    is_default = models.BooleanField("Categoria padrão do sistema", default=False)

    class Meta:
        verbose_name = "Categoria"
        verbose_name_plural = "Categorias"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SavingsBox(models.Model):
    """Cofrinho: reserva de dinheiro separada do saldo principal."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="savings_boxes",
        verbose_name="Usuário",
    )
    name = models.CharField("Nome", max_length=80)
    amount = models.DecimalField(
        "Valor guardado", max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    goal = models.DecimalField(
        "Meta", max_digits=12, decimal_places=2, null=True, blank=True
    )
    icon = models.CharField("Ícone", max_length=10, default="🐷")
    color = models.CharField("Cor", max_length=7, default="#d4ff3f")
    goal_alert_dismissed = models.BooleanField(
        "Aviso de meta dispensado", default=False,
        help_text="Volta a False quando a meta muda ou o valor cai abaixo dela.",
    )
    created_at = models.DateTimeField("Criado em", auto_now_add=True)

    class Meta:
        verbose_name = "Cofrinho"
        verbose_name_plural = "Cofrinhos"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.user.get_username()})"

    @property
    def progress_percent(self):
        """Percentual atingido da meta (0-100), ou None se não há meta."""
        if self.goal and self.goal > 0:
            pct = (self.amount / self.goal) * Decimal("100")
            return min(Decimal("100"), pct).quantize(Decimal("0.1"))
        return None

    @property
    def goal_reached(self):
        """True se o cofrinho já atingiu (ou superou) a meta definida."""
        return bool(self.goal) and self.amount >= self.goal


class SavingsMovement(models.Model):
    """Histórico de depósitos e resgates realizados em um cofrinho."""

    DEPOSIT = "deposit"
    WITHDRAW = "withdraw"
    TYPE_CHOICES = [
        (DEPOSIT, "Depósito"),
        (WITHDRAW, "Resgate"),
    ]

    savings_box = models.ForeignKey(
        SavingsBox, on_delete=models.CASCADE, related_name="movements", verbose_name="Cofrinho"
    )
    type = models.CharField("Tipo", max_length=8, choices=TYPE_CHOICES)
    value = models.DecimalField("Valor", max_digits=12, decimal_places=2)
    created_at = models.DateTimeField("Data", auto_now_add=True)

    class Meta:
        verbose_name = "Movimentação de cofrinho"
        verbose_name_plural = "Movimentações de cofrinhos"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_type_display()} de R$ {self.value} — {self.savings_box.name}"


class PaymentMethod(models.Model):
    """Forma de pagamento cadastrável pelo usuário (Pix, Dinheiro, Crédito...).

    O `kind` diz como o sistema deve tratá-la: formas do tipo cartão
    (crédito/débito) pedem a escolha de um cartão no lançamento.
    """

    DINHEIRO = "dinheiro"
    PIX = "pix"
    DEBITO = "debito"
    CREDITO = "credito"
    TRANSFERENCIA = "transferencia"
    BOLETO = "boleto"
    OUTRO = "outro"
    KIND_CHOICES = [
        (DINHEIRO, "Dinheiro"),
        (PIX, "Pix"),
        (DEBITO, "Cartão de débito"),
        (CREDITO, "Cartão de crédito"),
        (TRANSFERENCIA, "Transferência"),
        (BOLETO, "Boleto"),
        (OUTRO, "Outro"),
    ]
    CARD_KINDS = (DEBITO, CREDITO)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payment_methods",
        verbose_name="Usuário",
    )
    name = models.CharField("Nome", max_length=60)
    kind = models.CharField("Tipo", max_length=20, choices=KIND_CHOICES, default=OUTRO)
    icon = models.CharField("Ícone", max_length=10, default="💳")

    class Meta:
        verbose_name = "Forma de pagamento"
        verbose_name_plural = "Formas de pagamento"
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def uses_card(self):
        return self.kind in self.CARD_KINDS


class Card(models.Model):
    """Cartão do usuário, com limite e dias de fechamento/vencimento opcionais."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cards",
        verbose_name="Usuário",
    )
    name = models.CharField("Nome", max_length=60)
    limit = models.DecimalField(
        "Limite", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="Limite de crédito total. Deixe vazio se for só débito.",
    )
    closing_day = models.PositiveSmallIntegerField(
        "Dia de fechamento", null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
    )
    due_day = models.PositiveSmallIntegerField(
        "Dia de vencimento", null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
    )
    color = models.CharField("Cor", max_length=7, default="#d4ff3f")

    class Meta:
        verbose_name = "Cartão"
        verbose_name_plural = "Cartões"
        ordering = ["name"]

    def __str__(self):
        return self.name


class IncomeType(models.Model):
    """Tipo de entrada configurável (Salário, Freelance, Investimentos...)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="income_types",
        verbose_name="Usuário",
    )
    name = models.CharField("Nome", max_length=60)
    icon = models.CharField("Ícone", max_length=10, default="💵")
    color = models.CharField("Cor", max_length=7, default="#d4ff3f")

    class Meta:
        verbose_name = "Tipo de entrada"
        verbose_name_plural = "Tipos de entrada"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Recurrence(models.Model):
    """Lançamento fixo mensal (gasto fixo ou entrada fixa, ex: aluguel, salário).

    Todo mês o sistema gera automaticamente um `Transaction` para cada
    recorrência ativa (ver `finance/services.py`). `last_generated` guarda o
    primeiro dia do último mês já gerado, para não gerar o mesmo mês duas
    vezes — mesmo que a pessoa exclua o lançamento gerado.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recurrences",
        verbose_name="Usuário",
    )
    type = models.CharField("Tipo", max_length=7, choices=[("income", "Entrada"), ("expense", "Saída")])
    value = models.DecimalField(
        "Valor mensal", max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))]
    )
    description = models.CharField("Descrição", max_length=255, blank=True)
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Categoria"
    )
    income_type = models.ForeignKey(
        IncomeType, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Tipo de entrada"
    )
    payment_method = models.ForeignKey(
        PaymentMethod, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Forma de pagamento"
    )
    card = models.ForeignKey(Card, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Cartão")
    day_of_month = models.PositiveSmallIntegerField(
        "Dia do mês", validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    start_date = models.DateField("Início")
    end_date = models.DateField("Fim", null=True, blank=True)
    active = models.BooleanField("Ativo", default=True)
    last_generated = models.DateField("Último mês gerado", null=True, blank=True)
    created_at = models.DateTimeField("Criado em", auto_now_add=True)

    class Meta:
        verbose_name = "Lançamento fixo"
        verbose_name_plural = "Lançamentos fixos"
        ordering = ["day_of_month", "description"]

    def __str__(self):
        return f"{self.description or 'Fixo'} — R$ {self.value}/mês"


class InstallmentPlan(models.Model):
    """Compra parcelada: guarda o valor total e o número de parcelas.

    As parcelas em si são `Transaction`s (uma por mês) ligadas a este plano.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="installment_plans",
        verbose_name="Usuário",
    )
    description = models.CharField("Descrição", max_length=255, blank=True)
    total_value = models.DecimalField("Valor total", max_digits=12, decimal_places=2)
    installments = models.PositiveSmallIntegerField("Parcelas")
    first_date = models.DateField("Data da 1ª parcela")
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Categoria"
    )
    payment_method = models.ForeignKey(
        PaymentMethod, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Forma de pagamento"
    )
    card = models.ForeignKey(Card, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Cartão")
    created_at = models.DateTimeField("Criado em", auto_now_add=True)

    class Meta:
        verbose_name = "Parcelamento"
        verbose_name_plural = "Parcelamentos"
        ordering = ["-first_date", "-created_at"]

    def __str__(self):
        return f"{self.description or 'Parcelamento'} — {self.installments}x"


class Transaction(models.Model):
    """Lançamento financeiro: um gasto (saída) ou uma entrada de dinheiro.

    Usar um único modelo com o campo `type` simplifica os relatórios, que
    passam a agregar tudo a partir de uma mesma tabela.

    `applied` indica se o lançamento já foi refletido no saldo da carteira.
    Lançamentos com data futura (parcelas e fixos dos próximos meses) ficam
    como "previstos" (`applied=False`) até a data chegar.
    """

    INCOME = "income"
    EXPENSE = "expense"
    TYPE_CHOICES = [
        (INCOME, "Entrada"),
        (EXPENSE, "Saída"),
    ]

    AVISTA = "avista"
    PARCELADO = "parcelado"
    FIXO = "fixo"
    KIND_CHOICES = [
        (AVISTA, "À vista"),
        (PARCELADO, "Parcelado"),
        (FIXO, "Fixo"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="transactions",
        verbose_name="Usuário",
    )
    type = models.CharField("Tipo", max_length=7, choices=TYPE_CHOICES, default=EXPENSE)
    kind = models.CharField("Modalidade", max_length=10, choices=KIND_CHOICES, default=AVISTA)
    value = models.DecimalField(
        "Valor", max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))]
    )
    description = models.CharField("Descrição", max_length=255, blank=True)
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        related_name="transactions",
        verbose_name="Categoria",
        null=True,
        blank=True,
    )
    income_type = models.ForeignKey(
        IncomeType,
        on_delete=models.SET_NULL,
        related_name="transactions",
        verbose_name="Tipo de entrada",
        null=True,
        blank=True,
    )
    date = models.DateField("Data")
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.SET_NULL,
        related_name="transactions",
        verbose_name="Forma de pagamento",
        null=True,
        blank=True,
    )
    card = models.ForeignKey(
        Card,
        on_delete=models.SET_NULL,
        related_name="transactions",
        verbose_name="Cartão",
        null=True,
        blank=True,
    )
    recurrence = models.ForeignKey(
        Recurrence,
        on_delete=models.SET_NULL,
        related_name="transactions",
        verbose_name="Lançamento fixo",
        null=True,
        blank=True,
    )
    installment_plan = models.ForeignKey(
        InstallmentPlan,
        on_delete=models.CASCADE,
        related_name="transactions",
        verbose_name="Parcelamento",
        null=True,
        blank=True,
    )
    installment_number = models.PositiveSmallIntegerField("Nº da parcela", null=True, blank=True)
    applied = models.BooleanField("Refletido no saldo", default=True)
    created_at = models.DateTimeField("Criado em", auto_now_add=True)

    class Meta:
        verbose_name = "Lançamento"
        verbose_name_plural = "Lançamentos"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        sinal = "+" if self.type == self.INCOME else "-"
        return f"{sinal} R$ {self.value} — {self.description or self.get_type_display()}"

    @property
    def installment_label(self):
        """Ex: "3/10" para parcelas; None para os demais lançamentos."""
        if self.installment_plan_id and self.installment_number:
            return f"{self.installment_number}/{self.installment_plan.installments}"
        return None
