module.exports = {
  apps: [
    {
      name: 'tdban-backend',
      script: './server/index.js',
      cwd: '/var/www/tdBan',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      }
    }
  ]
};
