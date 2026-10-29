"""
Signals do app finance.

Ao criar um novo usuário (ex: pelo formulário de registro ou pelo admin),
criamos automaticamente sua Wallet (carteira/saldo), já com saldo zerado,
além das formas de pagamento e tipos de entrada padrão.
Assim, toda view pode assumir com segurança que `request.user.wallet` existe.
"""

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .defaults import FORMAS_PAGAMENTO_PADRAO, TIPOS_ENTRADA_PADRAO
from .models import IncomeType, PaymentMethod, Wallet


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def criar_wallet_do_usuario(sender, instance, created, **kwargs):
    """Cria a carteira e os cadastros padrão no primeiro save (registro)."""
    if created:
        Wallet.objects.get_or_create(user=instance)
        PaymentMethod.objects.bulk_create(
            PaymentMethod(user=instance, name=nome, kind=kind, icon=icone)
            for nome, kind, icone in FORMAS_PAGAMENTO_PADRAO
        )
        IncomeType.objects.bulk_create(
            IncomeType(user=instance, name=nome, icon=icone, color=cor)
            for nome, icone, cor in TIPOS_ENTRADA_PADRAO
        )
