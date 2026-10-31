import { defineConfig } from 'playwright/test';

// Phone-sized viewport (OnePlus 13R: 412×906 CSS px at DPR ≈3.07, portrait).
export const ONEPLUS_13R = {
  viewport: { width: 412, height: 906 },
  deviceScaleFactor: 3.07,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...ONEPLUS_13R,
    baseURL: 'http://localhost:4180',
    browserName: 'chromium',
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    port: 4180,
    reuseExistingServer: true,
  },
});
