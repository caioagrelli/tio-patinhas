# Deploy gratuito no PythonAnywhere

O site fica em `https://SEU_USUARIO.pythonanywhere.com`, sempre ligado, com o
banco SQLite salvo no próprio servidor. No plano gratuito é preciso entrar no
painel e clicar em **"Run until 3 months from today"** (aba Web) a cada 3 meses.

Em todos os comandos abaixo, troque `SEU_USUARIO` pelo seu usuário do PythonAnywhere.

## 1. Criar a conta

1. Acesse <https://www.pythonanywhere.com> → **Pricing & signup** → **Create a Beginner account** (grátis).
2. O nome de usuário escolhido vira o endereço do site.

## 2. Baixar o código (console Bash)

No painel, aba **Consoles** → **Bash**:

```bash
git clone https://github.com/caioagrelli/tio-patinhas.git
cd tio-patinhas
```

## 3. Ambiente virtual e dependências

Ainda no console (use a versão de Python mais nova que aparecer na aba Web, ex: 3.13):

```bash
mkvirtualenv --python=python3.13 tio-patinhas
pip install -r requirements.txt
```

> Se fechar o console, reative depois com `workon tio-patinhas`.

## 4. Configurar as variáveis (.env)

```bash
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(50))"   # copie a chave gerada
nano .env
```

No `nano`, cole a chave em `DJANGO_SECRET_KEY` e troque `SEU_USUARIO` em
`DJANGO_ALLOWED_HOSTS`. Salve com `Ctrl+O`, `Enter`, e saia com `Ctrl+X`.

## 5. Banco de dados e arquivos estáticos

```bash
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser    # opcional: acesso ao /admin/
```

## 6. Criar o site (aba Web)

1. **Add a new web app** → **Next** → **Manual configuration** (não escolha "Django") → mesma versão de Python do passo 3.
2. Na página do app, preencha:
   - **Source code:** `/home/SEU_USUARIO/tio-patinhas`
   - **Virtualenv:** `/home/SEU_USUARIO/.virtualenvs/tio-patinhas`
3. Clique no link do **WSGI configuration file**, apague tudo e cole:

   ```python
   import os
   import sys

   path = "/home/SEU_USUARIO/tio-patinhas"
   if path not in sys.path:
       sys.path.insert(0, path)

   os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"

   from django.core.wsgi import get_wsgi_application
   application = get_wsgi_application()
   ```

   Clique em **Save**.
4. Em **Security**, ligue **Force HTTPS**.
5. Clique no botão verde **Reload** no topo.

Pronto: abra `https://SEU_USUARIO.pythonanywhere.com` e crie sua conta.

## Atualizar depois de mudanças

Envie as mudanças para o GitHub (`git push`) e, no console Bash do PythonAnywhere:

```bash
workon tio-patinhas
cd ~/tio-patinhas && ./atualizar.sh
```

Depois clique em **Reload** na aba Web.

## Backup dos dados

Os dados ficam em `/home/SEU_USUARIO/tio-patinhas/db.sqlite3`. Para fazer
backup, baixe esse arquivo pela aba **Files**.

## Se algo der errado

- Aba **Web** → **Error log** (no fim da página) mostra o erro.
- "DisallowedHost": confira `DJANGO_ALLOWED_HOSTS` no `.env` e dê Reload.
- Página sem estilo: rode `python manage.py collectstatic --noinput` e dê Reload.
