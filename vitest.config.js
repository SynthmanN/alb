const { defineConfig } = require('vitest/config');

// Юнит- и API-тесты; e2e-спеки (Playwright) запускаются отдельно: npm run test:e2e
module.exports = defineConfig({
  test: { include: ['tests/**/*.test.js'] },
});
