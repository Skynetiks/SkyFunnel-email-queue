module.exports = {
  apps: [
    {
      name: 'skyfunnel-email-queue',
      script: './node_modules/.bin/ts-node',
      args: 'server.ts',
      watch: true,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Add other environment variables here
      }
    },
    {
      name: 'skyfunnel-admin-worker',
      script: './node_modules/.bin/ts-node',
      args: 'admin-worker.ts',
      watch: true,
      env_production: {
        NODE_ENV: 'production',
        // Add other environment variables here
      }
    }
  ]
};
