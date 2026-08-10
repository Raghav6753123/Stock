import mysql from 'mysql2/promise';
import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const host = process.env.DB_HOST || process.env.MYSQL_HOST;
const user = process.env.DB_USER || process.env.MYSQL_USER;
const password = process.env.DB_PASS || process.env.MYSQL_PASSWORD;
const port = Number(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306;
const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'stonks';

let pool;

function getPool() {
  if (!host || !user) {
    throw new Error('MySQL is not configured. Missing DB_HOST or DB_USER.');
  }

  if (!pool) {
    pool = mysql.createPool({
      host, user, password, port, database,
      waitForConnections: true, connectionLimit: 10, queueLimit: 0,
    });
  }
  return pool;
}

export default async function getConnection(databaseOverride = database) {
  const connection = await getPool().getConnection();
  if (databaseOverride) {
    await connection.query(`USE \`${databaseOverride}\``);
  }
  return connection;
}
