import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true, forbidOnly: !!process.env.CI, retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHROME_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } } : {}) } }, { name: 'mobile', use: { ...devices['Pixel 7'], ...(process.env.PLAYWRIGHT_CHROME_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } } : {}) } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: 'npm start', url: 'http://127.0.0.1:3100/api/health', env: { PORT: '3100', COOKIE_SECURE: 'false' }, reuseExistingServer: false, timeout: 60000 },
});
