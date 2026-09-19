const { defineConfig } = require('vitest/config');

// Аудит честности калькулятора крафта и скана маржи: гоняется отдельно (npm run audit:craft), в обычный npm test не входит.
module.exports = defineConfig({
  test: { include: ['audits/**/*.test.js'] },
});
