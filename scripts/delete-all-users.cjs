const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

function loadEnv() {
  const cwd = process.cwd();
  const projectRoot = path.resolve(__dirname, '..');
  const baseDirs = [cwd, projectRoot];
  const candidates = [];

  for (const baseDir of baseDirs) {
    candidates.push(path.join(baseDir, '.env.local'));
    candidates.push(path.join(baseDir, '.env'));
    candidates.push(path.join(baseDir, 'app', 'api', '.env.local'));
    candidates.push(path.join(baseDir, 'app', 'api', '.env'));
  }

  dotenv.config({ path: candidates });
}

function getDbConfig() {
  const host = process.env.DB_HOST ?? process.env.MYSQL_HOST;
  const user = process.env.DB_USER ?? process.env.MYSQL_USER;
  const password = process.env.DB_PASS ?? process.env.MYSQL_PASSWORD;
  const portRaw = process.env.DB_PORT ?? process.env.MYSQL_PORT;
  const database = process.env.DB_NAME ?? process.env.MYSQL_DATABASE ?? 'stonks';
  const port = portRaw ? Number(portRaw) : undefined;

  if (!host || !user) {
    throw new Error(
      'MySQL is not configured. Set DB_HOST and DB_USER (or MYSQL_HOST and MYSQL_USER) in .env.local'
    );
  }

  return {
    host,
    user,
    password,
    port: Number.isFinite(port) ? port : undefined,
    database,
  };
}

async function main() {
  loadEnv();
  const config = getDbConfig();

  const connection = await mysql.createConnection(config);
  try {
    const [result] = await connection.query('DELETE FROM `users`');
    console.log(`Deleted ${result.affectedRows ?? 0} user row(s) from users table.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Failed to delete users:', error.message || error);
  process.exitCode = 1;
});
