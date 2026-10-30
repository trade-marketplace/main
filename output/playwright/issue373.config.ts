import { defineConfig } from '@playwright/test';
import config from '../../playwright.config';
export default defineConfig({ ...config, testDir: '../../tests/e2e', outputDir: './issue-373/test-results', workers: 2, webServer: process.env.E2E_DEV_BASE_URL ? undefined : { ...config.webServer as object, command: 'npm run start -- --hostname 127.0.0.1 --port 3473', url: 'http://127.0.0.1:3473' }, use: { ...config.use, baseURL: 'http://127.0.0.1:3473' } });
