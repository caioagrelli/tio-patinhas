# Publicação

Produção roda com Docker Compose em um servidor (VPS), de preferência em São Paulo:

```
Visitante ─HTTPS─> Caddy ─┬─> app (N containers) ─┬─> PostgreSQL
                          │                       └─> Redis (limites de tentativas)
                          └─ certificados automáticos
backup (diário) ─> dump criptografado ─> restauração testada ─> armazenamento externo (R2/B2/S3)
```

- `compose.yaml`: banco, migrations (`migrate`) e app. Sozinho, serve para testar localmente.
- `compose.prod.yaml`: acrescenta Caddy (HTTPS e balanceamento), Redis e backup. Tira as portas do app e do banco da máquina.
- `deploy/deploy.sh`: publica uma versão nova e volta para a anterior se ela não ficar saudável.
- `.github/workflows/deploy.yml`: roda o deploy sozinho quando o CI passa na `main`.

## 0. AWS (Lightsail em São Paulo)

1. **Conta:** em aws.amazon.com, crie a conta e escolha o **plano pago** ("Paid plan"). Ele também ganha os US$ 100 a US$ 200 em créditos de conta nova e só cobra o que passar dos créditos. O plano "Free" **fecha a conta em 6 meses** (ou quando os créditos acabam) e apaga tudo 90 dias depois, o que derrubaria o site.
2. **Alerta de gastos:** em Billing > Budgets, crie um orçamento "Zero spend" ou de US$ 1 com aviso por e-mail. Assim você sabe no primeiro centavo cobrado no cartão.
3. **Servidor:** em lightsail.aws.amazon.com, troque a região para **São Paulo**, crie uma instância **Linux > Ubuntu 24.04 LTS**, plano de **US$ 24 (4 GB / 2 vCPU)**. Depois:
   - Networking > **Attach static IP** (grátis enquanto estiver ligado à instância);
   - Networking > IPv4 Firewall: adicione **HTTPS (TCP 443)** (SSH e HTTP já vêm abertos).
4. **Créditos:** no dia seguinte, confira em Billing > Credits se o Lightsail aparece entre os serviços cobertos e se a cobrança do dia saiu dos créditos. Se não estiver coberto, troque por uma EC2 `t3.medium` em São Paulo (os créditos cobrem EC2); o resto do guia é igual.
5. **Preparar o servidor:** no terminal do Lightsail (botão "Connect using SSH"), rode:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/<usuario>/<repo>/main/deploy/bootstrap-server.sh \
     | sudo DEPLOY_PUBLIC_KEY="<conteúdo de deploy_key.pub>" sh
   ```
   Ele instala o Docker, cria o usuário `deploy`, liga swap, atualizações automáticas e firewall, e desliga login por senha.

Depois siga a partir do item 2 da seção 1 (DNS e `.env`).

## 1. Preparar o servidor (uma vez)

1. Crie um VPS (2 vCPU / 4 GB é suficiente para começar) com Ubuntu 24.04 e rode `deploy/bootstrap-server.sh` como na seção 0 (instala Docker e libera só as portas 22, 80 e 443).
2. Aponte o DNS do domínio (registro A/AAAA) para o IP do servidor. Com a Cloudflare, ative o proxy (nuvem laranja) e use SSL "Full (strict)".
3. Crie a pasta do app e o `.env`:
   ```sh
   sudo mkdir -p /opt/crab-finance && sudo chown "$USER" /opt/crab-finance
   ```
   Copie o `.env.example` para `/opt/crab-finance/.env` e preencha:
   - `POSTGRES_PASSWORD`: `openssl rand -hex 32`.
   - `DOMAIN` (sem domínio ainda, use `<ip-com-hifens>.sslip.io`, ex.: `3-140-72-220.sslip.io`).
   - `TRUST_PROXY=1` (só o Caddy na frente) ou `TRUST_PROXY=2` (Cloudflare com proxy + Caddy).
   - `BACKUP_PASSPHRASE`: `openssl rand -hex 32`. **Guarde também num gerenciador de senhas**: sem ela os backups não abrem.
   - `BACKUP_REMOTE` e `BACKUP_S3_*` do armazenamento externo (ex.: um bucket do Cloudflare R2 com uma chave que só escreve nele).
   - Chaves de produção: Mercado Pago (incluindo `MERCADOPAGO_WEBHOOK_SECRET`, obrigatório em produção), Google, Turnstile e Anthropic.
4. Chave SSH só para o GitHub Actions (gere antes do passo 5 da seção 0, que já a instala no usuário `deploy`):
   ```sh
   ssh-keygen -t ed25519 -C github-deploy -f deploy_key -N ''   # no seu computador
   ssh-keyscan -t ed25519 IP-DO-SERVIDOR                        # saída vai para DEPLOY_KNOWN_HOSTS
   ```

## 2. Configurar o deploy automático (uma vez)

No GitHub, em Settings > Secrets and variables > Actions:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `DEPLOY_HOST` | secret | IP ou nome do servidor |
| `DEPLOY_USER` | secret | usuário de deploy |
| `DEPLOY_SSH_KEY` | secret | conteúdo de `deploy_key` (privada) |
| `DEPLOY_KNOWN_HOSTS` | secret | saída do `ssh-keyscan` |
| `DEPLOY_PATH` | variable | `/opt/crab-finance` (padrão) |

Em Settings > Environments, crie `production` (pode exigir aprovação antes de cada publicação).

A cada push na `main`: o CI roda tipos, lint, formatação e todos os testes. Se passar, o workflow **Deploy**:
1. gera a imagem Docker e envia para o GitHub Container Registry (`ghcr.io/<usuario>/<repo>:<commit>`);
2. copia `compose.yaml`, `compose.prod.yaml` e `deploy/` para o servidor;
3. roda `deploy/deploy.sh`, que aplica as migrations **uma vez** (serviço `migrate`), sobe `APP_REPLICAS` servidores do app e espera todos ficarem saudáveis. Se a versão nova não ficar saudável, volta sozinho para a anterior.

Também dá para publicar manualmente em Actions > Deploy > Run workflow, ou no servidor:

```sh
cd /opt/crab-finance && ./deploy/deploy.sh ghcr.io/<usuario>/<repo>:<commit>
```

**Migrations e rollback:** o rollback volta o código, não o banco. Escreva migrations compatíveis com a versão anterior: primeiro adicione colunas/tabelas, publique, e só remova o que ficou sem uso numa versão seguinte.

## 3. Crescer

- **Mais servidores do app:** aumente `APP_REPLICAS` no `.env` e publique de novo. O Caddy descobre os containers sozinho e o Redis mantém os limites de tentativas valendo para todos juntos.
- **Conexões ao banco:** cada servidor abre até `DATABASE_CONNECTION_LIMIT` conexões. `APP_REPLICAS x DATABASE_CONNECTION_LIMIT` precisa ficar abaixo do limite do banco (100 no PostgreSQL padrão).
- **Banco gerenciado** (recomendado acima de alguns milhares de usuários): crie um PostgreSQL gerenciado (RDS, Cloud SQL etc.) na mesma região, restaure o último backup nele (seção 5), troque o `DATABASE_URL` dos serviços `migrate` e `app` num `compose.override.yaml` e remova o serviço `db`. O backup automático do provedor passa a ser o principal; o serviço `backup` pode continuar como cópia extra.

## 4. Backup

O serviço `backup` roda todo dia em `BACKUP_TIME` (UTC):
1. `pg_dump` criptografado com AES-256 (`BACKUP_PASSPHRASE`);
2. **restauração de teste** num banco temporário, conferindo as migrations com o banco real (falha = alerta);
3. envio para `BACKUP_REMOTE` e remoção das cópias com mais de `BACKUP_KEEP_DAYS` dias.

Com `BACKUP_HEALTHCHECK_URL` (healthchecks.io, grátis), você recebe um aviso se algum dia passar sem backup.

```sh
docker compose -f compose.yaml -f compose.prod.yaml logs --tail 20 backup    # ver o último backup
docker compose -f compose.yaml -f compose.prod.yaml exec backup /scripts/backup.sh    # fazer um agora
```

## 5. Restaurar

```sh
c="docker compose -f compose.yaml -f compose.prod.yaml"
$c stop app
$c exec backup sh -c 'ls -1 /backups'                       # cópias locais
# ou baixe do armazenamento externo: $c exec backup rclone copy offsite:bucket/crab-finance/ARQUIVO /backups
$c exec backup /scripts/restore.sh /backups/ARQUIVO.dump.enc --confirmar
$c start app
```

## Atualizar à mão (sem GitHub Actions)

```sh
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

`docker compose down` preserva os dados; **`docker compose down -v` apaga o volume do PostgreSQL**. Não use `prisma db push` em produção: crie migrations com `npm run db:dev -- --name descricao` e versione o SQL.

## Dados pessoais (LGPD)

Cada pessoa pode excluir a própria conta em Configurações > Conta (ou na página de planos, se o teste já acabou). A exclusão cancela a assinatura no Mercado Pago e apaga lançamentos, cofrinhos, cartões, conversas do Crab AI e o login. Pagamentos e o consumo da IA ficam sem vínculo com a pessoa, para a contabilidade.
