# CRAB FINANCE — Controle Financeiro

Aplicação em **TypeScript**: NestJS, React/Vite, PostgreSQL e Prisma. Interface responsiva em português, com temas claro e escuro.

## Iniciar com Docker

Requisitos: Docker Engine com Docker Compose v2.

```sh
cp .env.example .env
# Edite POSTGRES_PASSWORD e a mesma senha em DATABASE_URL.
docker compose up --build -d
```

Acesse **http://localhost:8080** e crie uma conta com usuário e senha ou entre com Google (veja [Login com Google](#login-com-google)). O container aplica as migrations antes de iniciar. O PostgreSQL persiste no volume `postgres-data`; `docker compose down` preserva esse volume. `docker compose logs -f app` mostra os logs.

## Desenvolvimento local

Node.js **22.13+ (linha 22)** e npm. Docker é necessário para o PostgreSQL e para Testcontainers.

```sh
cp .env.example .env
npm ci
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

Interface: http://localhost:5173. API: http://localhost:3000/api. O Vite encaminha `/api` ao NestJS. Em produção, o NestJS serve também a interface compilada; não há necessidade de dois servidores públicos.

Se não houver Docker Compose, inicie apenas o PostgreSQL com Docker:

```sh
docker run -d --name tio-patinhas-dev-db --env-file .env \
  -p 127.0.0.1:5432:5432 \
  -v tio-patinhas-dev-postgres:/var/lib/postgresql/data \
  --restart unless-stopped postgres:17-alpine
npm run db:generate
npm run db:migrate
npm run dev
```

O volume `tio-patinhas-dev-postgres` guarda os dados entre reinícios. Use `docker stop tio-patinhas-dev-db` para parar e `docker start tio-patinhas-dev-db` para retomar. Escolha uma das formas de iniciar o banco, pois ambas usam a porta 5432. Cada forma tem seu próprio volume de dados.

```sh
npm run build
npm start
```

## Login com Google

Além de usuário e senha, é possível entrar com Google (OAuth 2.0 com PKCE). No primeiro acesso pelo Google, a conta e a carteira são criadas automaticamente; contas do Google e de senha são separadas. Sem as credenciais abaixo, o botão do Google não aparece.

1. Em console.cloud.google.com, crie um projeto e configure a **tela de consentimento OAuth** (tipo Externo).
2. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**, escolha **Aplicativo da Web** e cadastre em *URIs de redirecionamento autorizados*:
   - `http://localhost:5173/api/auth/google/callback` (desenvolvimento)
   - `http://localhost:8080/api/auth/google/callback` (Docker local)
3. Preencha no `.env` `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `APP_URL`, o endereço pelo qual você abre o site.

Abra o site exatamente pelo endereço de `APP_URL` (por exemplo, `localhost`, e não `127.0.0.1`); caso contrário, o Google recusa o redirecionamento.

## Funcionalidades

- Cadastro e login com usuário e senha ou com Google; sessões revogáveis no banco e cookie HttpOnly/SameSite. Cloudflare Turnstile opcional antes do login.
- Carteira; criação, edição, exclusão e filtros de entradas e saídas.
- Lançamentos futuros só afetam o saldo quando chega a data, no próximo acesso autenticado.
- Parcelamentos mensais com distribuição exata de centavos; excluir o plano reverte as parcelas realizadas.
- Recorrências mensais desde o início, com fim opcional, pausa e edição. Excluir uma recorrência preserva o histórico; alterações valem para meses ainda não gerados. Excluir um lançamento gerado não o recria.
- Cofrinhos com meta, depósitos, resgates, histórico e aviso de meta persistente. Excluir devolve o dinheiro para a carteira.
- Categorias padrão protegidas e cadastros próprios: categorias, cartões, formas de pagamento e tipos de entrada.
- Ciclo de fatura e limite comprometido com parcelas futuras; projeção de seis meses.
- Páginas iguais às da versão Django: Dashboard, Gastos, Entradas, Finanças, Cofrinhos, Relatórios e Configurações (engrenagem), com URLs próprias (`#/gastos/novo`, `#/cofrinhos/<id>/depositar`...) e mensagens de confirmação e aviso no topo.
- Finanças: dicas e alertas do mês, saldo previsto, fatura e limite dos cartões, projeção de 6 meses (gráfico e tabela), fixos com renda comprometida, parcelamentos em andamento e quitados e próximos 30 dias.
- Relatórios por período (mês atual, anterior, 30 dias, ano, tudo ou personalizado): categorias em pizza ou barras, evolução de 6 meses e agrupamentos por modalidade, forma de pagamento, cartão e tipo de entrada. Relatórios incluem previstos; os indicadores do mês no dashboard incluem realizados.

O processamento de vencimentos ocorre no acesso à aplicação. As configurações permitem gerenciar os cadastros financeiros.

## Testes

```sh
npm run typecheck
npm run lint                # ESLint (TypeScript + regras de hooks do React)
npm run format              # Prettier; o CI roda format:check
npm test                    # Jest + fast-check (2.000 cenários de parcelamento)
npm run test:integration    # Supertest + Testcontainers + PostgreSQL real
npm run test:coverage       # unitários + integração, relatório HTML/lcov
npx playwright install --with-deps chromium
npm run test:e2e            # Playwright: desktop e celular; axe para acessibilidade
npm run test:all            # tudo acima, na ordem do CI
```

Testcontainers sobe um PostgreSQL temporário, aplica as migrations e remove o container no final. Cada execução usa um schema aleatório: **os testes não usam DATABASE_URL nem apagam o banco da aplicação**. Opcionalmente, forneça `TEST_DATABASE_URL` de um servidor de testes: o schema continua isolado. O comando de navegador também prepara um banco isolado, compila a aplicação e abre um servidor temporário na porta 3100.

Os testes de integração cobrem autenticação por senha e por Google (com o Google simulado), CSRF, validação, isolamento entre usuários, saldo, rollback, depósitos simultâneos, parcelas, recorrências, cartões, projeções e relatórios. Playwright guarda trace, vídeo e captura em caso de falha. Relatórios: `coverage/index.html` e `playwright-report/index.html`.

Para usar o Chrome já instalado, defina `PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome`. Para testar um ambiente dedicado já iniciado, defina `PLAYWRIGHT_BASE_URL`; nesse modo o runner não prepara nem limpa o banco remoto. e os testes criam contas nesse ambiente.

### Testes totalmente em Docker

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests tests
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from e2e e2e
docker compose -f compose.test.yaml down
```

O ambiente de testes usa banco em `tmpfs` e não compartilha os volumes da aplicação. No GitHub Actions, a pipeline executa tipagem, cobertura, testes no navegador e build da imagem.

## Organização

```text
server/src/           API NestJS, autenticação e regras financeiras
web/src/              interface React e estilos
shared/               validação Zod compartilhada
prisma/               schema PostgreSQL e migrations versionadas
tests/unit/           regras e testes de propriedades
tests/integration/    API com banco real
tests/e2e/            fluxos no navegador e acessibilidade
```

Todos os valores monetários da API são **centavos inteiros** (R$ 10,50 = `1050`), armazenados como `BIGINT`. As operações que alteram dinheiro usam transações e bloqueio da linha do usuário no PostgreSQL, inclusive entre múltiplas instâncias. Datas financeiras usam `YYYY-MM-DD` e o dia civil de Recife. Consulte [DEPLOY.md](DEPLOY.md) para publicação (HTTPS com Caddy, vários servidores com Redis, deploy automático pelo GitHub Actions com rollback) e backups diários criptografados com restauração testada.
