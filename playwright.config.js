// e2e-тесты в настоящем браузере: десктоп и телефон (узкий экран → карточки вместо таблиц).
const { defineConfig, devices } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');

const PORT = 4100;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 700 }, hasTouch: true } },
  ],
  webServer: {
    command: 'node server.js',
    port: PORT,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      DISABLE_RATE_LIMIT: 'true', // десятки запросов с одного IP за секунды в тестах — норма
      DISABLE_JUG_CRAWLER: 'true', // фоновый краулер в e2e не нужен
      JUG_DB_PATH: ':memory:',      // и реальную базу кувшина e2e не трогает
      // тесты мастерок пишут во временный файл, а не в data/user-masteries.json пользователя
      USER_MASTERIES_PATH: path.join(os.tmpdir(), `albion-masteries-e2e-${process.pid}.json`),
    },
  },
});
