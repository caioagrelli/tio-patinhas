"""
Testes automatizados do app finance.

Rodar com:  python manage.py test
"""

from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Card, Category, IncomeType, InstallmentPlan, PaymentMethod, Recurrence, SavingsBox, Transaction, Wallet
from .services import add_months, gerar_recorrencias, resumo_cartao, valores_das_parcelas


class WalletSignalTests(TestCase):
    """Toda conta nova já deve nascer com uma Wallet zerada."""

    def test_wallet_criada_automaticamente(self):
        user = User.objects.create_user(username="ana", password="senha12345")
        self.assertTrue(Wallet.objects.filter(user=user).exists())
        self.assertEqual(user.wallet.balance, Decimal("0.00"))


class LoginRootTests(TestCase):
    """A raiz do site ("/") deve ser a tela de login."""

    def test_root_e_tela_de_login(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "finance/login.html")

    def test_dashboard_exige_login(self):
        response = self.client.get(reverse("dashboard"))
        self.assertEqual(response.status_code, 302)  # redireciona para o login


class TransactionWalletBalanceTests(TestCase):
    """Gastos e entradas devem manter o saldo da carteira sempre correto."""

    def setUp(self):
        self.user = User.objects.create_user(username="carlos", password="senha12345")
        self.client.force_login(self.user)

    def test_entrada_soma_no_saldo(self):
        self.client.post(reverse("income_create"), {
            "value": "500.00", "description": "Salário", "date": "2026-01-05",
        })
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("500.00"))

    def test_gasto_subtrai_do_saldo(self):
        self.client.post(reverse("income_create"), {
            "value": "500.00", "description": "Salário", "date": "2026-01-05",
        })
        self.client.post(reverse("expense_create"), {
            "value": "120.00", "description": "Mercado", "date": "2026-01-06",
        })
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("380.00"))

    def test_excluir_gasto_devolve_saldo(self):
        self.client.post(reverse("expense_create"), {
            "value": "80.00", "description": "Uber", "date": "2026-01-06",
        })
        gasto = Transaction.objects.get(description="Uber")
        self.client.post(reverse("transaction_delete", args=[gasto.pk]))
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("0.00"))
        self.assertFalse(Transaction.objects.filter(pk=gasto.pk).exists())


class SavingsBoxTests(TestCase):
    """Depósitos e resgates devem mover dinheiro entre carteira e cofrinho."""

    def setUp(self):
        self.user = User.objects.create_user(username="bia", password="senha12345")
        self.client.force_login(self.user)
        self.user.wallet.balance = Decimal("1000.00")
        self.user.wallet.save()
        self.box = SavingsBox.objects.create(user=self.user, name="Emergência", goal=Decimal("200.00"))

    def test_deposito_move_dinheiro_para_o_cofrinho(self):
        self.client.post(reverse("savingsbox_deposit", args=[self.box.pk]), {"value": "200.00"})
        self.user.wallet.refresh_from_db()
        self.box.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("800.00"))
        self.assertEqual(self.box.amount, Decimal("200.00"))
        self.assertTrue(self.box.goal_reached)

    def test_deposito_maior_que_saldo_e_bloqueado(self):
        self.client.post(reverse("savingsbox_deposit", args=[self.box.pk]), {"value": "5000.00"})
        self.user.wallet.refresh_from_db()
        self.box.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("1000.00"))
        self.assertEqual(self.box.amount, Decimal("0.00"))

    def test_resgate_devolve_para_a_carteira(self):
        self.box.amount = Decimal("150.00")
        self.box.save()
        self.client.post(reverse("savingsbox_withdraw", args=[self.box.pk]), {"value": "150.00"})
        self.user.wallet.refresh_from_db()
        self.box.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("1150.00"))
        self.assertEqual(self.box.amount, Decimal("0.00"))

    def test_excluir_cofrinho_devolve_valor_guardado(self):
        self.box.amount = Decimal("150.00")
        self.box.save()
        self.client.post(reverse("savingsbox_delete", args=[self.box.pk]))
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("1150.00"))
        self.assertFalse(SavingsBox.objects.filter(pk=self.box.pk).exists())


class IsolamentoEntreUsuariosTests(TestCase):
    """Um usuário nunca pode ver ou alterar dados de outro."""

    def setUp(self):
        self.user1 = User.objects.create_user(username="user1", password="senha12345")
        self.user2 = User.objects.create_user(username="user2", password="senha12345")
        self.box_user1 = SavingsBox.objects.create(user=self.user1, name="Só do user1")

    def test_usuario_nao_ve_cofrinho_de_outro(self):
        self.client.force_login(self.user2)
        response = self.client.get(reverse("savingsbox_list"))
        self.assertNotContains(response, "Só do user1")

    def test_usuario_nao_acessa_editar_cofrinho_de_outro(self):
        self.client.force_login(self.user2)
        response = self.client.get(reverse("savingsbox_update", args=[self.box_user1.pk]))
        self.assertEqual(response.status_code, 404)


class CategoryTests(TestCase):
    """Categorias padrão são visíveis a todos; categorias próprias só ao dono."""

    def setUp(self):
        self.user = User.objects.create_user(username="dan", password="senha12345")
        self.client.force_login(self.user)
        # Nome propositalmente distinto das categorias já semeadas pela migration
        # 0002 (que também roda no banco de testes), para não colidir com elas.
        self.categoria_padrao = Category.objects.create(name="Pets", icon="🐶", is_default=True)

    def test_categoria_padrao_aparece_na_listagem(self):
        response = self.client.get(reverse("category_list"))
        self.assertContains(response, "Pets")

    def test_nao_pode_editar_categoria_padrao(self):
        response = self.client.get(reverse("category_update", args=[self.categoria_padrao.pk]))
        self.assertEqual(response.status_code, 404)

    def test_excluir_categoria_nao_apaga_transacao(self):
        categoria = Category.objects.create(name="Hobbies", user=self.user)
        transacao = Transaction.objects.create(
            user=self.user, type=Transaction.EXPENSE, value=Decimal("50.00"),
            category=categoria, date="2026-01-01",
        )
        self.client.post(reverse("category_delete", args=[categoria.pk]))
        transacao.refresh_from_db()
        self.assertIsNone(transacao.category)


class CadastrosPadraoTests(TestCase):
    def test_usuario_novo_ganha_formas_e_tipos_de_entrada(self):
        user = User.objects.create_user(username="eva", password="senha12345")
        self.assertTrue(PaymentMethod.objects.filter(user=user, kind=PaymentMethod.PIX).exists())
        self.assertTrue(PaymentMethod.objects.filter(user=user, kind=PaymentMethod.CREDITO).exists())
        self.assertTrue(IncomeType.objects.filter(user=user, name="Salário").exists())


class ParceladoTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fabio", password="senha12345")
        self.client.force_login(self.user)
        self.hoje = timezone.localdate()

    def test_valores_das_parcelas_somam_o_total(self):
        parcelas = valores_das_parcelas(Decimal("100.00"), 3)
        self.assertEqual(sum(parcelas), Decimal("100.00"))
        self.assertEqual(parcelas, [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")])

    def test_parcelado_gera_parcelas_e_so_debita_as_vencidas(self):
        self.client.post(reverse("expense_create"), {
            "kind": "parcelado", "value": "1000.00", "installments": "10",
            "description": "Geladeira", "date": self.hoje.isoformat(),
        })
        plano = InstallmentPlan.objects.get(user=self.user)
        parcelas = plano.transactions.order_by("installment_number")
        self.assertEqual(parcelas.count(), 10)
        self.assertEqual(parcelas[1].date, add_months(self.hoje, 1))
        self.assertEqual(parcelas[3].installment_label, "4/10")
        self.user.wallet.refresh_from_db()
        # Só a 1ª parcela (hoje) sai do saldo; as outras ficam previstas
        self.assertEqual(self.user.wallet.balance, Decimal("-100.00"))
        self.assertEqual(parcelas.filter(applied=False).count(), 9)

    def test_parcelado_exige_numero_de_parcelas(self):
        self.client.post(reverse("expense_create"), {
            "kind": "parcelado", "value": "1000.00", "date": self.hoje.isoformat(),
        })
        self.assertFalse(Transaction.objects.filter(user=self.user).exists())

    def test_excluir_parcelamento_devolve_parcelas_pagas(self):
        self.client.post(reverse("expense_create"), {
            "kind": "parcelado", "value": "300.00", "installments": "3",
            "date": add_months(self.hoje, -1).isoformat(),
        })
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("-200.00"))
        plano = InstallmentPlan.objects.get(user=self.user)
        self.client.post(reverse("installment_plan_delete", args=[plano.pk]))
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("0.00"))
        self.assertFalse(Transaction.objects.filter(user=self.user).exists())


class FixoTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="gil", password="senha12345")
        self.client.force_login(self.user)
        self.hoje = timezone.localdate()

    def _criar_fixo(self, inicio, valor="150.00"):
        self.client.post(reverse("expense_create"), {
            "kind": "fixo", "value": valor, "description": "Academia", "date": inicio.isoformat(),
        })
        return Recurrence.objects.get(user=self.user)

    def test_fixo_gera_meses_desde_o_inicio_sem_duplicar(self):
        rec = self._criar_fixo(add_months(self.hoje, -2))
        self.assertEqual(rec.transactions.count(), 3)  # 2 meses atrás, mês passado e este mês
        self.client.get(reverse("dashboard"))  # novo processamento não duplica
        self.assertEqual(rec.transactions.count(), 3)
        self.user.wallet.refresh_from_db()
        self.assertEqual(self.user.wallet.balance, Decimal("-450.00"))

    def test_fixo_gera_o_proximo_mes_quando_ele_chega(self):
        rec = self._criar_fixo(self.hoje)
        gerar_recorrencias(self.user, ate=add_months(self.hoje, 2))
        self.assertEqual(rec.transactions.count(), 3)
        self.assertEqual(rec.transactions.filter(applied=False).count(), 2)

    def test_excluir_lancamento_gerado_nao_recria(self):
        rec = self._criar_fixo(self.hoje)
        tx = rec.transactions.get()
        self.client.post(reverse("transaction_delete", args=[tx.pk]))
        self.client.get(reverse("dashboard"))
        self.assertEqual(rec.transactions.count(), 0)

    def test_pausar_fixo_para_de_gerar(self):
        rec = self._criar_fixo(self.hoje)
        rec.active = False
        rec.save()
        gerar_recorrencias(self.user, ate=add_months(self.hoje, 3))
        self.assertEqual(rec.transactions.count(), 1)

    def test_fixo_aparece_no_relatorio(self):
        self._criar_fixo(self.hoje.replace(day=1))
        response = self.client.get(reverse("reports"))
        self.assertEqual(response.context["total_fixos"], Decimal("150.00"))
        self.assertContains(response, "Academia")


class CartaoTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="hugo", password="senha12345")
        self.client.force_login(self.user)
        self.credito = PaymentMethod.objects.get(user=self.user, kind=PaymentMethod.CREDITO)
        self.cartao = Card.objects.create(user=self.user, name="Nubank", limit=Decimal("1000.00"))
        self.hoje = timezone.localdate()

    def test_credito_exige_escolher_o_cartao(self):
        self.client.post(reverse("expense_create"), {
            "value": "50.00", "date": self.hoje.isoformat(), "payment_method": self.credito.pk,
        })
        self.assertFalse(Transaction.objects.filter(user=self.user).exists())

    def test_forma_que_nao_e_cartao_descarta_cartao(self):
        pix = PaymentMethod.objects.get(user=self.user, kind=PaymentMethod.PIX)
        self.client.post(reverse("expense_create"), {
            "value": "50.00", "date": self.hoje.isoformat(), "payment_method": pix.pk, "card": self.cartao.pk,
        })
        self.assertIsNone(Transaction.objects.get(user=self.user).card)

    def test_limite_usado_inclui_parcelas_futuras(self):
        self.client.post(reverse("expense_create"), {
            "kind": "parcelado", "value": "600.00", "installments": "3", "date": self.hoje.isoformat(),
            "payment_method": self.credito.pk, "card": self.cartao.pk,
        })
        resumo = resumo_cartao(self.cartao)
        self.assertEqual(resumo["usado"], Decimal("600.00"))
        self.assertEqual(resumo["disponivel"], Decimal("400.00"))
        self.assertEqual(resumo["fatura"], Decimal("200.00"))

    def test_nao_usa_cartao_de_outro_usuario(self):
        outro = User.objects.create_user(username="ivo", password="senha12345")
        cartao_outro = Card.objects.create(user=outro, name="Do outro")
        self.client.post(reverse("expense_create"), {
            "value": "50.00", "date": self.hoje.isoformat(), "payment_method": self.credito.pk, "card": cartao_outro.pk,
        })
        self.assertFalse(Transaction.objects.filter(user=self.user).exists())


class EntradaTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="jade", password="senha12345")
        self.client.force_login(self.user)

    def test_entrada_usa_tipo_e_nao_forma_de_pagamento(self):
        salario = IncomeType.objects.get(user=self.user, name="Salário")
        pix = PaymentMethod.objects.get(user=self.user, kind=PaymentMethod.PIX)
        self.client.post(reverse("income_create"), {
            "value": "3000.00", "date": "2026-01-05", "income_type": salario.pk, "payment_method": pix.pk,
        })
        tx = Transaction.objects.get(user=self.user)
        self.assertEqual(tx.income_type, salario)
        self.assertIsNone(tx.payment_method)

    def test_formulario_de_entrada_nao_mostra_forma_de_pagamento(self):
        response = self.client.get(reverse("income_create"))
        self.assertNotContains(response, 'name="payment_method"')
        self.assertContains(response, 'name="income_type"')


class ConfiguracoesTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="kim", password="senha12345")
        self.client.force_login(self.user)

    def test_todas_as_abas_abrem(self):
        for aba in ("aparencia", "categorias", "pagamento", "cartoes", "entradas"):
            self.assertEqual(self.client.get(reverse("settings", args=[aba])).status_code, 200, aba)
        self.assertEqual(self.client.get(reverse("settings", args=["inexistente"])).status_code, 404)

    def test_cadastrar_cartao_com_limite(self):
        self.client.post(reverse("settings_create", args=["cartoes"]), {
            "name": "Inter", "limit": "2500.00", "closing_day": "3", "due_day": "10", "color": "#ff7a00",
        })
        cartao = Card.objects.get(user=self.user)
        self.assertEqual(cartao.limit, Decimal("2500.00"))

    def test_nao_edita_forma_de_pagamento_de_outro(self):
        outro = User.objects.create_user(username="leo", password="senha12345")
        forma = PaymentMethod.objects.filter(user=outro).first()
        response = self.client.get(reverse("settings_update", args=["pagamento", forma.pk]))
        self.assertEqual(response.status_code, 404)


class TelasTests(TestCase):
    """Smoke test das telas principais com dados de todos os tipos."""

    def test_telas_abrem_com_dados(self):
        user = User.objects.create_user(username="mia", password="senha12345")
        self.client.force_login(user)
        hoje = timezone.localdate().isoformat()
        credito = PaymentMethod.objects.get(user=user, kind=PaymentMethod.CREDITO)
        cartao = Card.objects.create(user=user, name="Nubank", limit=Decimal("500.00"), closing_day=5, due_day=12)
        self.client.post(reverse("expense_create"), {"kind": "parcelado", "value": "900", "installments": "3",
                                                     "date": hoje, "payment_method": credito.pk, "card": cartao.pk})
        self.client.post(reverse("expense_create"), {"kind": "fixo", "value": "1200", "description": "Aluguel", "date": hoje})
        self.client.post(reverse("income_create"), {"kind": "fixo", "value": "5000", "description": "Salário", "date": hoje})
        for nome in ("dashboard", "expense_list", "income_list", "finance", "reports", "expense_create", "income_create"):
            response = self.client.get(reverse(nome))
            self.assertEqual(response.status_code, 200, nome)
        for period in ("mes_anterior", "ano_atual", "tudo", "30_dias"):
            self.assertEqual(self.client.get(reverse("reports"), {"period": period}).status_code, 200)
        response = self.client.get(reverse("finance"))
        self.assertContains(response, "Nubank")
        self.assertContains(response, "Aluguel")


class AvisoMetaCofrinhoTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="nina", password="senha12345")
        self.client.force_login(self.user)
        self.box = SavingsBox.objects.create(user=self.user, name="Viagem", goal=Decimal("100"), amount=Decimal("100"))

    def test_fechar_aviso_nao_volta_ao_recarregar(self):
        self.assertContains(self.client.get(reverse("dashboard")), "Meta do cofrinho")
        self.client.post(reverse("savingsbox_dismiss_alert", args=[self.box.pk]))
        self.assertNotContains(self.client.get(reverse("dashboard")), "Meta do cofrinho")

    def test_aviso_volta_se_cair_abaixo_da_meta_e_atingir_de_novo(self):
        self.client.post(reverse("savingsbox_dismiss_alert", args=[self.box.pk]))
        self.user.wallet.balance = Decimal("500")
        self.user.wallet.save()
        self.client.post(reverse("savingsbox_withdraw", args=[self.box.pk]), {"value": "50"})
        self.client.post(reverse("savingsbox_deposit", args=[self.box.pk]), {"value": "50"})
        self.assertContains(self.client.get(reverse("dashboard")), "Meta do cofrinho")

    def test_nao_dispensa_aviso_de_cofrinho_de_outro(self):
        outro = User.objects.create_user(username="otto", password="senha12345")
        box_outro = SavingsBox.objects.create(user=outro, name="X", goal=Decimal("1"), amount=Decimal("1"))
        self.client.post(reverse("savingsbox_dismiss_alert", args=[box_outro.pk]))
        box_outro.refresh_from_db()
        self.assertFalse(box_outro.goal_alert_dismissed)
