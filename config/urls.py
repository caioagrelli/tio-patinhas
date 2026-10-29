"""
URLs raiz do projeto.

Toda a lógica de rotas do sistema financeiro fica isolada em `finance.urls`,
incluída aqui na raiz ("/"), de forma que a tela de login (root) e as demais
telas do app fiquem sob o mesmo domínio, ex: /gastos/, /cofrinhos/ etc.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("finance.urls")),
]
