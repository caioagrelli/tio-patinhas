from django.contrib import admin

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


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("user", "balance", "updated_at")
    search_fields = ("user__username", "user__email")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "icon", "color", "is_default", "user")
    list_filter = ("is_default",)
    search_fields = ("name",)


class SavingsMovementInline(admin.TabularInline):
    model = SavingsMovement
    extra = 0
    readonly_fields = ("type", "value", "created_at")
    can_delete = False


@admin.register(SavingsBox)
class SavingsBoxAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "amount", "goal", "goal_reached", "created_at")
    list_filter = ("user",)
    search_fields = ("name", "user__username")
    inlines = [SavingsMovementInline]


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "type", "kind", "value", "category", "description", "user", "payment_method", "card", "applied")
    list_filter = ("type", "kind", "applied", "category")
    search_fields = ("description", "user__username")
    date_hierarchy = "date"


@admin.register(PaymentMethod)
class PaymentMethodAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "user")
    list_filter = ("kind",)


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("name", "limit", "closing_day", "due_day", "user")


@admin.register(IncomeType)
class IncomeTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "icon", "user")


@admin.register(Recurrence)
class RecurrenceAdmin(admin.ModelAdmin):
    list_display = ("description", "type", "value", "day_of_month", "active", "last_generated", "user")
    list_filter = ("type", "active")


@admin.register(InstallmentPlan)
class InstallmentPlanAdmin(admin.ModelAdmin):
    list_display = ("description", "total_value", "installments", "first_date", "user")
