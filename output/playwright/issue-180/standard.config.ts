import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config';
export default defineConfig({ ...base, testDir: '../../../tests/e2e', workers: 1, webServer: { ...base.webServer, command: 'npm run start -- --port 3181', url: 'http://127.0.0.1:3181' }, use: { ...base.use, baseURL: 'http://127.0.0.1:3181' } });
