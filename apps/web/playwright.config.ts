import { defineConfig, devices } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

/**
 * End-to-end tests drive the real web app against the real API and database
 * (the seeded dev database). Servers already running locally are reused;
 * otherwise Playwright starts them.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // tests share the one demo rider
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run dev:api',
      cwd: '../..',
      url: `${API_URL}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npx next dev -p 3000',
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
