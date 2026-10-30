import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config';
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({ ...base, testDir: '../../../tests/e2e', workers: 2, use: { ...base.use, baseURL: 'http://127.0.0.1:3114' }, webServer: [
  { ...server, command: 'npm run start -- --hostname 127.0.0.1 --port 3114', url: 'http://127.0.0.1:3114' },
  { ...server, command: 'npm run start -- --hostname 127.0.0.1 --port 3314', url: 'http://127.0.0.1:3314', env: { ...server?.env, SCREENSHOT_DEV_PAGES: '1' } },
] });
