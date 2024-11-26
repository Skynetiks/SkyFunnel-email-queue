// eslint-disable-next-line no-undef
module.exports = {
    apps: [
      {
        name: 'skyfunnel-email-queue-server',
        script: 'npm run start:server',
        watch: false,
        env_production: {
          NODE_ENV: 'production',
          PORT: 3000,
          // Add other environment variables here
        }
      },
      {
        name: 'skyfunnel-email-queue-worker',
        script: 'npm run start:worker',
        watch: false,
        env_production: {
          NODE_ENV: 'production',
          // Add other environment variables here
        }
      },
      {
        name: 'skyfunnel-admin-worker',
        script: 'npm run start:admin-worker',
        watch: false,
        env_production: {
          NODE_ENV: 'production',
          // Add other environment variables here
        }
      }
    ]
  };