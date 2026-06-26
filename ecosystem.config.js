// PM2 Ecosystem Config — used to run the app on the VPS
module.exports = {
  apps: [
    {
      name: 'tdban-server',
      script: './server/index.js',
      cwd: '/var/www/tdBan', // ← change to your VPS deployment path
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
