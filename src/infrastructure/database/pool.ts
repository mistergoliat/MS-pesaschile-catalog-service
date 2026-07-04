import mysql from 'mysql2/promise';
import { config } from '../../shared/config.js';

export function createPool() {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: 'Z',
    namedPlaceholders: false,
  });
}

export type DbPool = Awaited<ReturnType<typeof createPool>>;
