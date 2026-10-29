"""
URLs do app finance.

A raiz do site ("/") é a tela de login, conforme exigido no requisito 1.
"""

from django.urls import path

from . import views

urlpatterns = [
    # Autenticação -----------------------------------------------------------
    path("", views.TelaLoginView.as_view(), name="login"),
    path("registrar/", views.registrar_view, name="registrar"),
    path("logout/", views.logout_view, name="logout"),
    # Dashboard ---------------------------------------------------------------
    path("dashboard/", views.dashboard_view, name="dashboard"),
    # Gastos (saídas) -----------------------------------------------------------
    path("gastos/", views.expense_list_view, name="expense_list"),
    path("gastos/novo/", views.expense_create_view, name="expense_create"),
    path("gastos/<int:pk>/editar/", views.expense_update_view, name="expense_update"),
    # Entradas -----------------------------------------------------------------
    path("entradas/", views.income_list_view, name="income_list"),
    path("entradas/nova/", views.income_create_view, name="income_create"),
    path("entradas/<int:pk>/editar/", views.income_update_view, name="income_update"),
    # Exclusão de lançamento (compartilhada entre gasto/entrada) ----------------
    path("lancamentos/<int:pk>/excluir/", views.transaction_delete_view, name="transaction_delete"),
    # Cofrinhos ------------------------------------------------------------------
    path("cofrinhos/", views.savingsbox_list_view, name="savingsbox_list"),
    path("cofrinhos/novo/", views.savingsbox_create_view, name="savingsbox_create"),
    path("cofrinhos/<int:pk>/editar/", views.savingsbox_update_view, name="savingsbox_update"),
    path("cofrinhos/<int:pk>/excluir/", views.savingsbox_delete_view, name="savingsbox_delete"),
    path("cofrinhos/<int:pk>/depositar/", views.savingsbox_deposit_view, name="savingsbox_deposit"),
    path("cofrinhos/<int:pk>/resgatar/", views.savingsbox_withdraw_view, name="savingsbox_withdraw"),
    path("cofrinhos/<int:pk>/dispensar-aviso/", views.savingsbox_dismiss_alert_view, name="savingsbox_dismiss_alert"),
    # Finanças (fixos, parcelamentos, cartões, projeção) ------------------------
    path("financas/", views.finance_view, name="finance"),
    path("financas/fixos/<int:pk>/editar/", views.recurrence_update_view, name="recurrence_update"),
    path("financas/fixos/<int:pk>/excluir/", views.recurrence_delete_view, name="recurrence_delete"),
    path("financas/parcelamentos/<int:pk>/editar/", views.installment_plan_update_view, name="installment_plan_update"),
    path("financas/parcelamentos/<int:pk>/excluir/", views.installment_plan_delete_view, name="installment_plan_delete"),
    # Configurações (aparência, categorias, formas de pagamento, cartões, tipos de entrada)
    path("configuracoes/", views.settings_view, name="settings_home"),
    # Aliases com os nomes antigos das URLs de categoria
    path("configuracoes/categorias/", views.settings_view, {"aba": "categorias"}, name="category_list"),
    path("configuracoes/categorias/novo/", views.settings_item_save_view, {"aba": "categorias"}, name="category_create"),
    path("configuracoes/categorias/<int:pk>/editar/", views.settings_item_save_view, {"aba": "categorias"}, name="category_update"),
    path("configuracoes/categorias/<int:pk>/excluir/", views.settings_item_delete_view, {"aba": "categorias"}, name="category_delete"),
    path("configuracoes/<slug:aba>/", views.settings_view, name="settings"),
    path("configuracoes/<slug:aba>/novo/", views.settings_item_save_view, name="settings_create"),
    path("configuracoes/<slug:aba>/<int:pk>/editar/", views.settings_item_save_view, name="settings_update"),
    path("configuracoes/<slug:aba>/<int:pk>/excluir/", views.settings_item_delete_view, name="settings_delete"),
    # Relatórios -----------------------------------------------------------------------
    path("relatorios/", views.reports_view, name="reports"),
]
