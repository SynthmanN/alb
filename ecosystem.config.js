// Конфигурация pm2: npx pm2 start ecosystem.config.js && npx pm2 save
// NODE_ENV=production — Express не отдаёт клиенту стектрейсы необработанных ошибок; настройка живёт в файле,
// поэтому переживает перезапуск и перезагрузку сервера (в отличие от переменной, заданной вручную в консоли).
// Когда перед сайтом появится reverse-proxy с TLS, добавить в env: TRUST_PROXY: 'true' (иначе лимит по IP будет общим на всех).
module.exports = {
  apps: [
    {
      name: 'albion-market',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
