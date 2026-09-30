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
    // The built site, served by Next (pages and the API routes). Transcription goes to the service on
    // TRANSCRIBE_URL when it is running (npm run server); the test that needs it is skipped otherwise.
    command: 'npx next build && npx next start --port 4174',
    env: { TRANSCRIBE_URL: process.env.TRANSCRIBE_URL ?? 'http://127.0.0.1:8787' },
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
