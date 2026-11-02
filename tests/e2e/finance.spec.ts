import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
async function register(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar uma conta' }).click();
  await page.getByLabel('Seu nome').fill('Pessoa de teste');
  const username = 'e2e-' + randomUUID();
  await page.getByLabel('E-mail', { exact: true }).fill(username + '@example.com');
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste-forte');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa de teste', exact: true })).toBeVisible();
  await expect(page.getByText('Saldo disponível', { exact: true })).toBeVisible();
  return username;
}
const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true }).click();
const flash = (page: Page, text: string | RegExp) =>
  expect(page.locator('.flash').filter({ hasText: text })).toBeVisible();
const balance = (page: Page) => page.locator('.stat.accent strong');
async function income(page: Page, amount = '1000') {
  await page.getByRole('link', { name: '＋ Adicionar entrada' }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill(amount);
  await page.getByLabel('Descrição', { exact: true }).fill('Salário de teste');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Entrada salva com sucesso!');
}
test('entrada, gasto, edição e exclusão mantêm saldo', async ({ page }) => {
  await register(page);
  await income(page);
  await menu(page, 'Dashboard');
  await expect(balance(page)).toContainText('1.000,00');
  await menu(page, 'Gastos');
  await page.getByRole('link', { name: '+ Adicionar gasto' }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('120.50');
  await page.getByLabel('Descrição', { exact: true }).fill('Mercado');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Gasto salvo com sucesso!');
  const row = page.locator('.record-row', { hasText: 'Mercado' });
  await expect(row).toContainText('120,50');
  await row.getByRole('link', { name: 'Editar' }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Lançamento atualizado!');
  await expect(row).toContainText('150,00');
  await expect(page.locator('.total-strip')).toContainText('150,00');
  await expect(row.getByRole('link', { name: /Excluir/ })).toHaveCount(0);
  await row.getByRole('link', { name: 'Editar Mercado' }).click();
  await page.getByRole('link', { name: 'Excluir lançamento' }).click();
  await expect(page.getByText(/será devolvido ao seu saldo/)).toBeVisible();
  await page.getByRole('button', { name: 'Sim, excluir', exact: true }).click();
  await flash(page, 'Lançamento excluído.');
  await menu(page, 'Dashboard');
  await expect(balance(page)).toContainText('1.000,00');
});
test('cofrinho atinge meta, registra resgate e devolve saldo na exclusão', async ({ page }) => {
  await register(page);
  await income(page);
  await menu(page, 'Cofrinhos');
  await page.getByRole('link', { name: '+ Novo cofrinho' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Viagem');
  await page.getByLabel('Meta (R$)').fill('200');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Cofrinho "Viagem" criado!');
  await page.getByRole('link', { name: 'Depositar', exact: true }).click();
  await expect(page.getByText('Saldo disponível: R$ 1.000,00')).toBeVisible();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Confirmar depósito' }).click();
  await flash(page, 'guardado(s) em "Viagem"');
  await expect(page.getByText('🎉 Meta atingida')).toBeVisible();
  await expect(page.locator('.goal-banner')).toContainText('Meta do cofrinho "Viagem" atingida!');
  await page.getByRole('button', { name: 'Fechar aviso' }).click();
  await page.reload();
  await expect(page.locator('.goal-banner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Resgatar', exact: true }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Confirmar resgate' }).click();
  await expect(page.getByRole('alert')).toHaveText('O cofrinho não tem esse valor guardado.');
  await page.getByLabel('Valor (R$)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Confirmar resgate' }).click();
  await flash(page, 'resgatado(s) de "Viagem"');
  await expect(page.locator('.savings .box-amount')).toContainText('150,00');
  await page.getByRole('link', { name: 'Excluir', exact: true }).click();
  await page.getByRole('button', { name: 'Sim, excluir', exact: true }).click();
  await flash(page, 'O valor guardado voltou para o seu saldo.');
  await menu(page, 'Dashboard');
  await expect(balance(page)).toContainText('1.000,00');
});
test('parcelamento, fixo, finanças, relatório e configurações funcionam', async ({ page }) => {
  await register(page);
  await page.getByRole('link', { name: '+ Adicionar gasto' }).click();
  await page.getByText('Parcelado', { exact: true }).click();
  await page.getByLabel('Valor total da compra (R$)').fill('300');
  await page.getByLabel('Nº de parcelas').fill('3');
  await expect(page.getByText('3x de R$ 100,00 — uma parcela por mês, a partir da data escolhida.')).toBeVisible();
  await page.getByLabel('Descrição', { exact: true }).fill('Notebook');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Compra parcelada em 3x de R$ 100,00 registrada!');
  await page.getByRole('link', { name: '+ Adicionar gasto' }).click();
  await page.getByText('Fixo todo mês', { exact: true }).click();
  await page.getByLabel('Valor mensal (R$)').fill('50');
  await page.getByLabel('Descrição', { exact: true }).fill('Academia');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, /Gasto fixo cadastrado!/);
  await page.getByLabel('Modalidade').selectOption('parcelado');
  await expect(page.locator('.record-row')).toHaveCount(1);
  await expect(page.locator('.record-row')).toContainText('Parcela 1/3');
  await menu(page, 'Finanças');
  await expect(page.locator('.plan-row', { hasText: 'Notebook' })).toContainText('1/3 pagas · 3x de R$ 100,00');
  await expect(page.locator('.record-row', { hasText: 'Academia' }).first()).toContainText('R$ 50,00');
  await page.locator('.record-row', { hasText: 'Academia' }).first().getByRole('link', { name: 'Editar' }).click();
  await page.getByLabel('Ativo (continua gerando todo mês)').uncheck();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Lançamento fixo atualizado!');
  await expect(page.locator('.record-row', { hasText: 'Academia' }).first()).toContainText('pausado');
  await menu(page, 'Relatórios');
  await expect(page.getByRole('heading', { name: 'Gastos por categoria' })).toBeVisible();
  await page.getByRole('button', { name: 'Barras', exact: true }).click();
  await expect(page.getByRole('img', { name: /Distribuição de gastos/ })).toBeVisible();
  await page.getByRole('link', { name: 'Últimos 30 dias' }).click();
  await expect(page.getByRole('link', { name: 'Últimos 30 dias' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('link', { name: 'Categorias', exact: true }).click();
  await page.getByRole('link', { name: '+ Adicionar categoria' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Meus hobbies');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await flash(page, 'Categoria salva!');
  await expect(page.getByText('Meus hobbies', { exact: true })).toBeVisible();
});
test('logout protege dados e permite novo login', async ({ page }) => {
  const username = await register(page);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continuar com Google', exact: true })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste-forte');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa de teste', exact: true })).toBeVisible();
});
test('acessibilidade e layout em desktop e celular', async ({ page }) => {
  await register(page);
  await income(page);
  // Colors are measured without transitions, so a theme switch is never caught halfway.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  const pages: [string, string][] = [
    ['dashboard', 'Olá, Pessoa de teste'],
    ['gastos', 'Gastos'],
    ['gastos/novo', 'Novo gasto'],
    ['financas', 'Finanças'],
    ['cofrinhos', 'Cofrinhos'],
    ['relatorios', 'Relatórios'],
    ['configuracoes/cartoes', 'Configurações'],
    ['configuracoes/conta', 'Configurações'],
    ['crab-ai', 'Crab AI'],
    ['planos', 'Escolha o plano ideal para você'],
    ['planos/checkout?plano=anual', 'Pagamento'],
  ];
  for (const [path, title] of pages) {
    await page.goto('/#/' + path);
    await expect(page.locator('main h1')).toHaveText(title);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => {
        document.documentElement.dataset.theme = t;
      }, theme);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations, `${path} (${theme})`).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});
