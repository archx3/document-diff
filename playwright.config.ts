import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a preinstalled Chromium when one is available (e.g. in sandboxed environments).
const localChromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 1400, height: 900 },
    launchOptions: localChromium ? { executablePath: localChromium } : {},
  },
  webServer: {
    // The site is a static export (out/); Vite's preview server serves it.
    command: 'npx next build && npx vite preview --outDir out --port 4174 --strictPort',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
