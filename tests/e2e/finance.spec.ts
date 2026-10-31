import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
async function register(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar uma conta' }).click();
  await page.getByLabel('Seu nome').fill('Pessoa de teste');
  const username = 'e2e-' + randomUUID();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste-forte');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByText('Saldo disponível', { exact: true })).toBeVisible();
  return username;
}
async function income(page: Page, amount = '1000') {
  await page.getByRole('button', { name: '+ Nova entrada', exact: true }).click();
  await page.getByLabel('Descrição', { exact: true }).fill('Salário de teste');
  await page.getByLabel('Valor (R$)', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
test('cadastro, entrada, gasto, edição e exclusão mantêm saldo', async ({ page }) => {
  await register(page); await income(page);
  await expect(page.locator('.stat.accent strong')).toContainText('1.000,00');
  await page.getByRole('link', { name: 'Saídas', exact: true }).click();
  await page.getByRole('button', { name: '+ Nova saída' }).click();
  await page.getByLabel('Descrição', { exact: true }).fill('Mercado'); await page.getByLabel('Valor (R$)', { exact: true }).fill('120.50');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'Mercado À vista', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Mercado' }).click(); await page.getByLabel('Valor (R$)', { exact: true }).fill('150'); await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(page.getByRole('cell', { name: /150,00/ })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir Mercado' }).click(); await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await page.getByRole('link', { name: 'Visão geral', exact: true }).click();
  await expect(page.locator('.stat.accent strong')).toContainText('1.000,00');
});
test('cofrinho atinge meta, registra resgate e devolve saldo na exclusão', async ({ page }) => {
  await register(page); await income(page);
  await page.getByRole('link', { name: 'Cofrinhos', exact: true }).click(); await page.getByRole('button', { name: '+ Novo cofrinho' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Viagem'); await page.getByLabel('Meta (R$, opcional)').fill('200'); await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await page.getByRole('button', { name: 'Depositar', exact: true }).click();
  await page.getByLabel('Valor (R$)', { exact: true }).fill('200'); await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(page.getByText('Meta atingida ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar aviso Viagem' }).click(); await page.reload(); await expect(page.getByRole('button', { name: 'Fechar aviso Viagem' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resgatar', exact: true }).click(); await page.getByLabel('Valor (R$)', { exact: true }).fill('50'); await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(page.locator('.box-amount')).toContainText('150,00');
  await page.getByRole('button', { name: 'Excluir', exact: true }).click(); await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await page.getByRole('link', { name: 'Visão geral', exact: true }).click(); await expect(page.locator('.stat.accent strong')).toContainText('1.000,00');
});
test('parcelamento, recorrência, relatório e configurações funcionam', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: '+ Nova saída', exact: true }).click();
  await page.getByLabel('Descrição', { exact: true }).fill('Notebook'); await page.getByLabel('Valor (R$)', { exact: true }).fill('100'); await page.getByLabel('Modalidade').selectOption('parcelado');
  await page.getByLabel('Número de parcelas').fill('3'); await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '+ Nova saída', exact: true }).click(); await page.getByLabel('Descrição', { exact: true }).fill('Academia'); await page.getByLabel('Valor (R$)', { exact: true }).fill('50'); await page.getByLabel('Modalidade').selectOption('fixo'); await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Planejamento', exact: true }).click();
  const plans = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Compras parceladas', exact: true }) });
  await expect(plans.getByText('Notebook', { exact: true })).toBeVisible();
  await expect(plans.getByText('3 parcelas · 1 realizadas', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Notebook Parcela 2/3', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Notebook Parcela 3/3', exact: true })).toBeVisible();
  await expect(page.getByText('Academia', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Relatórios', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Saídas por categoria' })).toBeVisible(); await page.getByRole('button', { name: 'Ver pizza' }).click(); await expect(page.getByRole('img', { name: /Distribuição de saídas/ })).toBeVisible();
  await page.getByRole('link', { name: 'Configurações', exact: true }).click(); await page.getByRole('button', { name: '+ Novo cadastro' }).click(); await page.getByLabel('Nome', { exact: true }).fill('Meus hobbies'); await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(page.getByText('💰 Meus hobbies', { exact: true })).toBeVisible();
});
test('logout protege dados e permite novo login', async ({ page }) => {
  const username = await register(page); await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible(); await page.reload();
  await page.getByLabel('Usuário', { exact: true }).fill(username); await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste-forte'); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
});
test('acessibilidade e layout em desktop e celular', async ({ page }) => {
  await register(page);
  const dark = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(dark.violations).toEqual([]);
  await page.getByRole('button', { name: 'Alternar tema' }).click();
  const light = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(light.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
