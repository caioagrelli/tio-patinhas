from django.apps import AppConfig


class FinanceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "finance"
    verbose_name = "Controle Financeiro"

    def ready(self):
        # Importa os signals (criação automática de Wallet ao registrar usuário)
        from . import signals  # noqa: F401
