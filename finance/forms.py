"""
Formulários do sistema.

Todos os campos de texto/número/data/select recebem classes Tailwind no
próprio widget, para que os templates possam simplesmente fazer
`{{ form.campo }}` e já sair estilizado (as cores vêm de variáveis CSS, então
funcionam tanto no tema escuro quanto no claro).
"""

from decimal import Decimal

from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User
from django.db.models import Q

from .models import Card, Category, IncomeType, InstallmentPlan, PaymentMethod, Recurrence, SavingsBox, Transaction

# Classes Tailwind reutilizadas nos widgets -----------------------------------

INPUT_CLASSES = (
    "w-full rounded-lg bg-field border border-borderdark text-fg "
    "placeholder-muted/70 px-4 py-2.5 text-sm focus:outline-none "
    "focus:ring-2 focus:ring-neon focus:border-transparent transition"
)
SELECT_CLASSES = INPUT_CLASSES
CHECKBOX_CLASSES = "h-4 w-4 rounded border-borderdark bg-field accent-neon focus:ring-neon"


class LoginForm(AuthenticationForm):
    """AuthenticationForm padrão do Django, só com os widgets estilizados."""

    username = forms.CharField(
        label="Usuário",
        widget=forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "nome_de_usuario", "autofocus": True}),
    )
    password = forms.CharField(
        label="Senha",
        widget=forms.PasswordInput(attrs={"class": INPUT_CLASSES, "placeholder": "••••••••"}),
    )


class RegisterForm(UserCreationForm):
    """Formulário de cadastro de conta: nome, e-mail, usuário e senha."""

    first_name = forms.CharField(
        label="Nome",
        max_length=150,
        widget=forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "Seu nome"}),
    )
    email = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"class": INPUT_CLASSES, "placeholder": "voce@email.com"}),
    )

    class Meta:
        model = User
        fields = ["first_name", "username", "email", "password1", "password2"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].widget.attrs.update(
            {"class": INPUT_CLASSES, "placeholder": "nome_de_usuario"}
        )
        self.fields["password1"].widget.attrs.update(
            {"class": INPUT_CLASSES, "placeholder": "••••••••"}
        )
        self.fields["password2"].widget.attrs.update(
            {"class": INPUT_CLASSES, "placeholder": "Confirme a senha"}
        )
        self.fields["username"].label = "Usuário"
        self.fields["password1"].label = "Senha"
        self.fields["password2"].label = "Confirmar senha"

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data["email"]
        if commit:
            user.save()
        return user


class CartaoMixin:
    """Validação comum: forma de pagamento do tipo cartão pede o cartão."""

    def _limitar_querysets(self, user):
        if "payment_method" in self.fields:
            self.fields["payment_method"].queryset = PaymentMethod.objects.filter(user=user)
            self.fields["payment_method"].required = False
            self.fields["payment_method"].empty_label = "Selecione…"
        if "card" in self.fields:
            self.fields["card"].queryset = Card.objects.filter(user=user)
            self.fields["card"].required = False
            self.fields["card"].empty_label = "Selecione o cartão…"
        if "category" in self.fields:
            self.fields["category"].queryset = Category.objects.filter(categorias_disponiveis_para(user))
            self.fields["category"].required = False
            self.fields["category"].empty_label = "Sem categoria"
        if "income_type" in self.fields:
            self.fields["income_type"].queryset = IncomeType.objects.filter(user=user)
            self.fields["income_type"].required = False
            self.fields["income_type"].empty_label = "Sem tipo"

    def _validar_cartao(self, cleaned):
        metodo = cleaned.get("payment_method")
        if "card" not in self.fields:
            return
        if metodo is None or not metodo.uses_card:
            cleaned["card"] = None
        elif metodo.kind == PaymentMethod.CREDITO and not cleaned.get("card"):
            self.add_error("card", "Escolha qual cartão de crédito foi usado.")


WIDGETS_LANCAMENTO = {
    "value": forms.NumberInput(attrs={"class": INPUT_CLASSES, "placeholder": "0,00", "step": "0.01", "min": "0.01"}),
    "description": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Almoço no restaurante"}),
    "category": forms.Select(attrs={"class": SELECT_CLASSES}),
    "income_type": forms.Select(attrs={"class": SELECT_CLASSES}),
    "date": forms.DateInput(attrs={"class": INPUT_CLASSES, "type": "date"}, format="%Y-%m-%d"),
    "payment_method": forms.Select(attrs={"class": SELECT_CLASSES, "data-payment-method": ""}),
    "card": forms.Select(attrs={"class": SELECT_CLASSES}),
}


class LancamentoForm(CartaoMixin, forms.Form):
    """Formulário de criação de gasto/entrada.

    Gasto: à vista, parcelado (valor total + nº de parcelas) ou fixo mensal.
    Entrada: única ou fixa mensal (ex: salário). Quem decide o tipo é a view.
    """

    kind = forms.ChoiceField(
        label="Como é esse lançamento?",
        choices=Transaction.KIND_CHOICES,
        initial=Transaction.AVISTA,
        required=False,
        widget=forms.RadioSelect,
    )
    value = forms.DecimalField(label="Valor (R$)", max_digits=12, decimal_places=2, min_value=Decimal("0.01"),
                               widget=WIDGETS_LANCAMENTO["value"])
    installments = forms.IntegerField(
        label="Nº de parcelas", min_value=2, max_value=120, required=False,
        widget=forms.NumberInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: 10", "min": "2", "max": "120"}),
    )
    description = forms.CharField(label="Descrição", max_length=255, required=False,
                                  widget=WIDGETS_LANCAMENTO["description"])
    category = forms.ModelChoiceField(label="Categoria", queryset=Category.objects.none(),
                                      widget=WIDGETS_LANCAMENTO["category"])
    income_type = forms.ModelChoiceField(label="Tipo de entrada", queryset=IncomeType.objects.none(),
                                         widget=WIDGETS_LANCAMENTO["income_type"])
    date = forms.DateField(label="Data", widget=WIDGETS_LANCAMENTO["date"])
    end_date = forms.DateField(
        label="Termina em (opcional)", required=False,
        widget=forms.DateInput(attrs={"class": INPUT_CLASSES, "type": "date"}),
        help_text="Deixe vazio para repetir todo mês sem data para acabar.",
    )
    payment_method = forms.ModelChoiceField(label="Forma de pagamento", queryset=PaymentMethod.objects.none(),
                                            widget=WIDGETS_LANCAMENTO["payment_method"])
    card = forms.ModelChoiceField(label="Qual cartão?", queryset=Card.objects.none(),
                                  widget=WIDGETS_LANCAMENTO["card"])

    def __init__(self, *args, user=None, tx_type=Transaction.EXPENSE, **kwargs):
        super().__init__(*args, **kwargs)
        self.tx_type = tx_type
        if tx_type == Transaction.INCOME:
            for nome in ("installments", "category", "payment_method", "card"):
                del self.fields[nome]
            self.fields["kind"].choices = [(Transaction.AVISTA, "Única"), (Transaction.FIXO, "Fixa todo mês")]
            self.fields["description"].widget.attrs["placeholder"] = "Ex: Salário de outubro"
        else:
            del self.fields["income_type"]
            self.fields["kind"].choices = [
                (Transaction.AVISTA, "À vista"),
                (Transaction.PARCELADO, "Parcelado"),
                (Transaction.FIXO, "Fixo todo mês"),
            ]
        self._limitar_querysets(user)

    def clean(self):
        cleaned = super().clean()
        kind = cleaned["kind"] = cleaned.get("kind") or Transaction.AVISTA
        if kind == Transaction.PARCELADO and not cleaned.get("installments"):
            self.add_error("installments", "Informe em quantas parcelas foi.")
        if kind == Transaction.FIXO and cleaned.get("end_date") and cleaned.get("date") \
                and cleaned["end_date"] < cleaned["date"]:
            self.add_error("end_date", "A data final precisa ser depois do início.")
        self._validar_cartao(cleaned)
        return cleaned


class TransactionEditForm(CartaoMixin, forms.ModelForm):
    """Edição de um lançamento já existente (uma parcela, um mês do fixo...)."""

    class Meta:
        model = Transaction
        fields = ["value", "description", "category", "income_type", "date", "payment_method", "card"]
        widgets = WIDGETS_LANCAMENTO
        labels = {"value": "Valor (R$)", "card": "Qual cartão?"}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.type == Transaction.INCOME:
            for nome in ("category", "payment_method", "card"):
                del self.fields[nome]
        else:
            del self.fields["income_type"]
        self._limitar_querysets(user)

    def clean(self):
        cleaned = super().clean()
        self._validar_cartao(cleaned)
        return cleaned


class RecurrenceForm(CartaoMixin, forms.ModelForm):
    """Edição de um gasto/entrada fixo. Vale para os próximos meses gerados."""

    class Meta:
        model = Recurrence
        fields = ["value", "description", "category", "income_type", "payment_method", "card",
                  "day_of_month", "end_date", "active"]
        widgets = {
            **WIDGETS_LANCAMENTO,
            "day_of_month": forms.NumberInput(attrs={"class": INPUT_CLASSES, "min": "1", "max": "31"}),
            "end_date": forms.DateInput(attrs={"class": INPUT_CLASSES, "type": "date"}, format="%Y-%m-%d"),
            "active": forms.CheckboxInput(attrs={"class": CHECKBOX_CLASSES}),
        }
        labels = {"value": "Valor mensal (R$)", "card": "Qual cartão?", "end_date": "Termina em (opcional)",
                  "active": "Ativo (continua gerando todo mês)"}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.type == Transaction.INCOME:
            for nome in ("category", "payment_method", "card"):
                del self.fields[nome]
        else:
            del self.fields["income_type"]
        self._limitar_querysets(user)

    def clean(self):
        cleaned = super().clean()
        self._validar_cartao(cleaned)
        return cleaned


class InstallmentPlanForm(CartaoMixin, forms.ModelForm):
    """Edição dos dados comuns de um parcelamento (aplicados a todas as parcelas)."""

    class Meta:
        model = InstallmentPlan
        fields = ["description", "category", "payment_method", "card"]
        widgets = WIDGETS_LANCAMENTO
        labels = {"card": "Qual cartão?"}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._limitar_querysets(user)

    def clean(self):
        cleaned = super().clean()
        self._validar_cartao(cleaned)
        return cleaned


def categorias_disponiveis_para(user):
    """Q() reutilizável: categorias padrão do sistema OU criadas pelo próprio usuário."""
    return Q(is_default=True) | Q(user=user)


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ["name", "icon", "color"]
        widgets = {
            "name": forms.TextInput(
                attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Assinaturas"}
            ),
            "icon": forms.TextInput(
                attrs={"class": INPUT_CLASSES, "placeholder": "📦", "maxlength": "10"}
            ),
            "color": forms.TextInput(
                attrs={"class": INPUT_CLASSES + " h-11", "type": "color"}
            ),
        }
        labels = {"name": "Nome", "icon": "Ícone (emoji)", "color": "Cor"}


class PaymentMethodForm(forms.ModelForm):
    class Meta:
        model = PaymentMethod
        fields = ["name", "kind", "icon"]
        widgets = {
            "name": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Vale-refeição"}),
            "kind": forms.Select(attrs={"class": SELECT_CLASSES}),
            "icon": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "💳", "maxlength": "10"}),
        }
        labels = {"name": "Nome", "kind": "Tipo", "icon": "Ícone (emoji)"}
        help_texts = {"kind": "Formas do tipo cartão (crédito/débito) perguntam qual cartão foi usado."}


class CardForm(forms.ModelForm):
    class Meta:
        model = Card
        fields = ["name", "limit", "closing_day", "due_day", "color"]
        widgets = {
            "name": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Nubank"}),
            "limit": forms.NumberInput(attrs={"class": INPUT_CLASSES, "placeholder": "0,00", "step": "0.01", "min": "0"}),
            "closing_day": forms.NumberInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: 3", "min": "1", "max": "31"}),
            "due_day": forms.NumberInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: 10", "min": "1", "max": "31"}),
            "color": forms.TextInput(attrs={"class": INPUT_CLASSES + " h-11", "type": "color"}),
        }
        labels = {"name": "Nome do cartão", "limit": "Limite (R$)", "closing_day": "Dia de fechamento",
                  "due_day": "Dia de vencimento", "color": "Cor"}


class IncomeTypeForm(forms.ModelForm):
    class Meta:
        model = IncomeType
        fields = ["name", "icon", "color"]
        widgets = {
            "name": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Aluguel recebido"}),
            "icon": forms.TextInput(attrs={"class": INPUT_CLASSES, "placeholder": "💵", "maxlength": "10"}),
            "color": forms.TextInput(attrs={"class": INPUT_CLASSES + " h-11", "type": "color"}),
        }
        labels = {"name": "Nome", "icon": "Ícone (emoji)", "color": "Cor"}


class SavingsBoxForm(forms.ModelForm):
    """Criação/edição de cofrinho. O valor guardado (`amount`) nunca é
    editado diretamente aqui — só via depósito/resgate — para manter o saldo
    principal sempre consistente."""

    class Meta:
        model = SavingsBox
        fields = ["name", "goal", "icon", "color"]
        widgets = {
            "name": forms.TextInput(
                attrs={"class": INPUT_CLASSES, "placeholder": "Ex: Viagem para o Nordeste"}
            ),
            "goal": forms.NumberInput(
                attrs={"class": INPUT_CLASSES, "placeholder": "0,00 (opcional)", "step": "0.01", "min": "0"}
            ),
            "icon": forms.TextInput(
                attrs={"class": INPUT_CLASSES, "placeholder": "🐷", "maxlength": "10"}
            ),
            "color": forms.TextInput(
                attrs={"class": INPUT_CLASSES + " h-11", "type": "color"}
            ),
        }
        labels = {"name": "Nome do cofrinho", "goal": "Meta (opcional)", "icon": "Ícone", "color": "Cor"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["goal"].required = False


class SavingsMovementForm(forms.Form):
    """Formulário simples de valor, usado tanto para depósito quanto resgate."""

    value = forms.DecimalField(
        label="Valor (R$)",
        max_digits=12,
        decimal_places=2,
        min_value=0.01,
        widget=forms.NumberInput(
            attrs={"class": INPUT_CLASSES, "placeholder": "0,00", "step": "0.01", "autofocus": True}
        ),
    )


class PeriodFilterForm(forms.Form):
    """Filtro de período + categoria, usado nas telas de Gastos e Relatórios."""

    PERIODO_CHOICES = [
        ("mes_atual", "Mês atual"),
        ("mes_anterior", "Mês anterior"),
        ("30_dias", "Últimos 30 dias"),
        ("ano_atual", "Este ano"),
        ("tudo", "Tudo"),
        ("personalizado", "Personalizado"),
    ]

    period = forms.ChoiceField(
        choices=PERIODO_CHOICES,
        required=False,
        widget=forms.Select(attrs={"class": SELECT_CLASSES}),
    )
    start_date = forms.DateField(
        required=False, widget=forms.DateInput(attrs={"class": INPUT_CLASSES, "type": "date"})
    )
    end_date = forms.DateField(
        required=False, widget=forms.DateInput(attrs={"class": INPUT_CLASSES, "type": "date"})
    )
    category = forms.ModelChoiceField(
        queryset=Category.objects.none(),
        required=False,
        empty_label="Todas as categorias",
        widget=forms.Select(attrs={"class": SELECT_CLASSES}),
    )

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        if user is not None:
            self.fields["category"].queryset = Category.objects.filter(
                categorias_disponiveis_para(user)
            )
