module.exports = {
  apps: [
    {
      name: 'hezuguanjia',
      script: 'server/index.js',
      cwd: '/var/www/hezuguanjia',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 4330,
        BASE_PATH: '/hezuguanjia',
        DATA_DIR: '/var/www/hezuguanjia/data',
      },
      max_memory_restart: '400M',
      error_file: '/var/log/hezuguanjia/error.log',
      out_file: '/var/log/hezuguanjia/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
