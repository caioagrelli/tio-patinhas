# Tio Patinhas — Controle Financeiro Pessoal

Sistema web em Django para controle financeiro pessoal: saldo (carteira), gastos e entradas, cofrinhos com metas, categorias e relatórios por categoria com gráfico. Visual dark mode minimalista (Tailwind CSS via CDN + Chart.js).

## Requisitos

- Python 3.11+ (funciona também em 3.10/3.12)
- pip

## Instalação

```bash
# 1. Entre na pasta do projeto
cd controle_financeiro

# 2. Crie e ative um ambiente virtual
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Instale as dependências
pip install -r requirements.txt

# 4. Aplique as migrations
python manage.py migrate
```

O passo 4 já cria automaticamente as **7 categorias padrão** (Alimentação, Transporte, Lazer, Moradia, Saúde, Educação, Outros) através de uma *data migration* (`finance/migrations/0002_categorias_padrao.py`) — não é preciso rodar nada além do `migrate`. Se preferir carregá-las manualmente a partir do fixture incluído, também funciona:

```bash
python manage.py loaddata categorias_padrao
```

## Criar um usuário administrador (opcional, para acessar `/admin/`)

```bash
python manage.py createsuperuser
```

## Rodar o servidor

```bash
python manage.py runserver
```

Acesse **http://127.0.0.1:8000/** — a própria raiz do site já é a tela de login. Clique em "Criar conta" para se cadastrar (isso já cria seu usuário, sua carteira com saldo zerado e faz login automaticamente).

## Rodar os testes automatizados

```bash
python manage.py test
```

15 testes cobrem: criação automática da carteira, isolamento entre usuários, atualização de saldo em gastos/entradas (criar/editar/excluir), depósito e resgate em cofrinhos (incluindo bloqueio de saldo insuficiente), exclusão de cofrinho devolvendo o valor guardado, e regras de categoria (padrão vs. do usuário).

## Estrutura do projeto

```
controle_financeiro/
├── manage.py
├── requirements.txt
├── config/                  # settings, urls raiz, wsgi/asgi
├── static/css/style.css     # pequenos ajustes que o Tailwind CDN não cobre
└── finance/                 # app principal
    ├── models.py            # Wallet, Category, SavingsBox, SavingsMovement, Transaction
    ├── signals.py           # cria a Wallet automaticamente ao registrar usuário
    ├── context_processors.py# alerta no topo (ex: "meta do cofrinho atingida")
    ├── forms.py
    ├── views.py
    ├── urls.py
    ├── admin.py
    ├── tests.py
    ├── fixtures/categorias_padrao.json
    ├── migrations/
    │   ├── 0001_initial.py
    │   └── 0002_categorias_padrao.py   # seed das categorias padrão
    └── templates/finance/
        ├── base.html            # layout autenticado (navbar + faixa de alerta + footer)
        ├── base_public.html     # layout das telas de login/registro
        ├── login.html / register.html
        ├── dashboard.html
        ├── expense_list.html / expense_form.html
        ├── income_list.html / income_form.html
        ├── transaction_confirm_delete.html
        ├── savingsbox_list.html / savingsbox_form.html / savingsbox_movement.html / savingsbox_confirm_delete.html
        ├── category_list.html / category_form.html / category_confirm_delete.html
        ├── reports.html         # Chart.js + tabela, alimentados por agregação no backend
        └── partials/            # trechos reaproveitados entre telas de gasto/entrada
```

## Funcionalidades

- **Login/registro/logout** com `django.contrib.auth`. A raiz (`/`) é a tela de login; após autenticar, o usuário vai para `/dashboard/`. Todo dado é filtrado por `request.user` — um usuário nunca vê dados de outro (testado em `finance/tests.py`).
- **Carteira (Wallet)**: saldo único por usuário, criado automaticamente no cadastro (via signal `post_save` no `User`) e atualizado a cada gasto, entrada, depósito ou resgate.
- **Cofrinhos (SavingsBox)**: múltiplos cofrinhos com nome, ícone, cor e meta opcional. Depositar debita da carteira e credita no cofrinho; resgatar faz o caminho inverso; excluir devolve o valor guardado para a carteira. Ao atingir a meta, aparece um aviso na faixa neon no topo (via `context_processors.py`) e um selo "Meta atingida" nos cards.
- **Categorias**: 7 categorias padrão do sistema (comuns a todos os usuários, não editáveis) + categorias próprias de cada usuário (editáveis/excluíveis). Excluir uma categoria não apaga os lançamentos — eles ficam "sem categoria" (`on_delete=SET_NULL`).
- **Gastos e Entradas**: CRUD completo (`Transaction` com `type=income/expense`), com filtro por período (mês atual / últimos 30 dias / todo o período / intervalo customizado) e por categoria, usando chips/pills.
- **Relatórios**: agregação de gastos por categoria feita 100% no banco com `values().annotate(Sum(...))` (sem API externa), com total, percentual por categoria e gráfico (pizza/barras alternável) via Chart.js.

## Trocando para PostgreSQL em produção

Instale o driver:

```bash
pip install psycopg2-binary
```

E troque o bloco `DATABASES` em `config/settings.py` por:

```python
import os

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "controle_financeiro"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}
```

Lembre-se também de, em produção: definir `DEBUG = False`, gerar uma nova `SECRET_KEY` (e carregá-la de variável de ambiente), ajustar `ALLOWED_HOSTS`, e rodar `python manage.py collectstatic`.
