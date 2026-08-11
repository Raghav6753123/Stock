import mysql from 'mysql2/promise';
import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const connectionUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;

let parsedUrl = null;
try {
  parsedUrl = connectionUrl ? new URL(connectionUrl) : null;
} catch {
  throw new Error('Invalid MySQL connection URL. Use mysql://user:password@host:port/database.');
}

function decode(value) {
  try {
    return value ? decodeURIComponent(value) : '';
  } catch {
    return value || '';
  }
}

// Supports local DB_* variables, standard MySQL variables, and Railway's native variables.
const host = process.env.DB_HOST || process.env.MYSQL_HOST || process.env.MYSQLHOST || parsedUrl?.hostname;
const user = process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQLUSER || decode(parsedUrl?.username);
const password = process.env.DB_PASS || process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || decode(parsedUrl?.password);
const port = Number(process.env.DB_PORT || process.env.MYSQL_PORT || process.env.MYSQLPORT || parsedUrl?.port) || 3306;
const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || decode(parsedUrl?.pathname?.replace(/^\//, '')) || 'stonks';

let pool;

function getPool() {
  if (!host || !user) {
    throw new Error('MySQL is not configured. Set DB_* variables, Railway MYSQL* variables, or MYSQL_PUBLIC_URL.');
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
