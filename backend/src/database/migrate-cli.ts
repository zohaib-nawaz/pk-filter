import { config } from '../config.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
const ran = await migrate(pool);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
await pool.end();
