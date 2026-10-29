"""
Configurações do projeto "Controle Financeiro Pessoal".

Gerado a partir do 'django-admin startproject' e customizado para o
Tio Patinhas, sistema de controle financeiro pessoal (app `finance`).
"""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

# Caminhos do projeto: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Carrega variáveis de um arquivo .env na raiz do projeto, se existir (usado
# no servidor; nunca vai para o git). Ver .env.example.
load_dotenv(BASE_DIR / ".env")


# Configuração por variáveis de ambiente -----------------------------------
# Localmente nada precisa ser definido (DEBUG ligado, SQLite). Em produção:
#   DJANGO_DEBUG=0
#   DJANGO_SECRET_KEY=<chave longa e aleatória>
#   DJANGO_ALLOWED_HOSTS=meuapp.onrender.com   (separados por vírgula)
#   DATABASE_URL=postgres://...                (opcional; sem ela usa SQLite)
#   DJANGO_SSL_REDIRECT=0                      (opcional; quando a hospedagem já força HTTPS)

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Defina a variável de ambiente DJANGO_SECRET_KEY em produção.")
    SECRET_KEY = "django-insecure-somente-para-desenvolvimento-local"

ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]
# O Render informa o domínio do serviço nesta variável automaticamente
if os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])
if DEBUG:
    ALLOWED_HOSTS.append("*")

CSRF_TRUSTED_ORIGINS = [f"https://{h}" for h in ALLOWED_HOSTS if h != "*"]

if not DEBUG:
    # HTTPS atrás do proxy da hospedagem
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # No PythonAnywhere use DJANGO_SSL_REDIRECT=0 e ligue "Force HTTPS" no painel
    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SSL_REDIRECT", "1") == "1"


# Definição da aplicação -----------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # App principal do sistema de controle financeiro
    "finance",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serve os arquivos estáticos em produção, sem precisar de nginx
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Gera os gastos/entradas fixos do mês e aplica no saldo os previstos que venceram
    "finance.middleware.ProcessarLancamentosMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Diretório global de templates (fallback), além dos templates de cada app
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                # Context processor próprio: injeta alertas (ex: meta de
                # cofrinho atingida) na faixa de destaque do topo em todas as páginas
                "finance.context_processors.alertas_financeiros",
                "finance.context_processors.menu",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Banco de dados --------------------------------------------------------------
# Sem DATABASE_URL: SQLite local (db.sqlite3). Com DATABASE_URL (ex: Postgres
# gratuito do Neon), usa esse banco.

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}


# Validação de senhas -----------------------------------------------------------
# https://docs.djangoproject.com/en/5.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Internacionalização -----------------------------------------------------------
# https://docs.djangoproject.com/en/5.1/topics/i18n/

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True


# Arquivos estáticos (CSS, JavaScript, imagens) ---------------------------------
# https://docs.djangoproject.com/en/5.1/howto/static-files/

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"  # usado pelo `collectstatic` em produção

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    # Em produção: arquivos comprimidos e com hash no nome (cache longo e seguro)
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        if DEBUG
        else "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}

# Tipo padrão de chave primária
# https://docs.djangoproject.com/en/5.1/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Autenticação -------------------------------------------------------------------
# Para onde o usuário é redirecionado após login/logout e onde fica a tela de login.

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "login"
