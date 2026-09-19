// Аудит честности в настоящем браузере (npm run audit:craft:e2e): полный цикл скан → калькулятор → план продажи.
// Отдельный конфиг и порт — в обычный npm run test:e2e не входит.
const { defineConfig, devices } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');

const PORT = 4200;

module.exports = defineConfig({
  testDir: './audits',
  testMatch: /.*\.spec\.js/,
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'node server.js',
    port: PORT,
    reuseExistingServer: false,
    timeout: 20_000,
    env: { PORT: String(PORT), USER_MASTERIES_PATH: path.join(os.tmpdir(), `albion-masteries-audit-${process.pid}.json`) },
  },
});
