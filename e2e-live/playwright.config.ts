import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4180', browserName: 'chromium' },
  webServer: { command: 'node ../scripts/serve.mjs', cwd: '.', port: 4180, reuseExistingServer: true },
});
