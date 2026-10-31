# Publicação com Docker

O sistema exige Node.js/PostgreSQL ou uma hospedagem com Docker.

## Servidor

1. Instale Docker Engine e Compose v2 no servidor.
2. Copie o repositório, execute `cp .env.example .env` e configure uma senha forte em `POSTGRES_PASSWORD` e `DATABASE_URL`. Para evitar escape de caracteres na URL, gere uma senha hexadecimal com `openssl rand -hex 32`.
3. Configure `COOKIE_SECURE=true` para o domínio publicado por HTTPS. Para testar em `localhost` por HTTP, mantenha `false`.
4. Execute `docker compose up --build -d`.
5. Configure um proxy HTTPS (por exemplo, Caddy ou nginx) para `127.0.0.1:8080`. API e interface devem compartilhar a mesma origem. O aplicativo não habilita CORS.

A porta do app e a do banco estão vinculadas a localhost. Em produção, remova a publicação `ports` do serviço `db` se não precisar de acesso local. Não exponha o PostgreSQL à internet.

## Atualizar

Faça backup antes de atualizar. Depois de baixar a nova versão:

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail 100 app
```

O container aplica migrations versionadas com `prisma migrate deploy`. Falhas impedem o início do aplicativo. Crie mudanças de schema em desenvolvimento com `npm run db:dev -- --name descricao` e versione o SQL gerado. Não use `db push` em produção.

## Backup e recuperação

```sh
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup.dump
```

Teste a restauração em um ambiente separado e vazio antes de depender do backup:

```sh
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < backup.dump
```

Guarde backups fora do servidor. `docker compose down` preserva os dados; **`docker compose down -v` apaga o volume do PostgreSQL**.
