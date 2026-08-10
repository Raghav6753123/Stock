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
    const [tables] = await connection.query('SHOW TABLES');

    if (!tables || tables.length === 0) {
      console.log('No tables found in this database.');
      return;
    }

    for (const row of tables) {
      const tableName = Object.values(row)[0];
      console.log(`\n===== TABLE: ${tableName} =====`);

      const [data] = await connection.query(`SELECT * FROM \`${tableName}\``);
      console.log(`Rows: ${data.length}`);

      if (data.length === 0) {
        console.log('(empty table)');
      } else {
        console.table(data);
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Failed to list tables/data:', error.message || error);
  process.exitCode = 1;
});
