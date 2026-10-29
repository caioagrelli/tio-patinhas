# Data migration: cria as categorias padrão do sistema.
#
# Usamos RunPython (não `loaddata`) para não depender de PKs fixos do
# fixture — assim a migration funciona em qualquer banco novo, sempre que
# alguém rodar `python manage.py migrate`, sem passo manual extra.

from django.db import migrations

CATEGORIAS_PADRAO = [
    {"name": "Alimentação", "icon": "🍔", "color": "#d4ff3f"},
    {"name": "Transporte", "icon": "🚌", "color": "#4fd4ff"},
    {"name": "Lazer", "icon": "🎬", "color": "#ff4fd4"},
    {"name": "Moradia", "icon": "🏠", "color": "#ffb84f"},
    {"name": "Saúde", "icon": "💊", "color": "#4fff88"},
    {"name": "Educação", "icon": "📚", "color": "#a04fff"},
    {"name": "Outros", "icon": "📦", "color": "#a0a0a0"},
]


def criar_categorias_padrao(apps, schema_editor):
    Category = apps.get_model("finance", "Category")
    for dados in CATEGORIAS_PADRAO:
        Category.objects.get_or_create(
            name=dados["name"],
            is_default=True,
            user=None,
            defaults={"icon": dados["icon"], "color": dados["color"]},
        )


def remover_categorias_padrao(apps, schema_editor):
    Category = apps.get_model("finance", "Category")
    nomes = [c["name"] for c in CATEGORIAS_PADRAO]
    Category.objects.filter(name__in=nomes, is_default=True, user=None).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(criar_categorias_padrao, remover_categorias_padrao),
    ]
