import pg from 'pg';

export function createPool(connectionString: string, onError: (error: Error) => void): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', onError);
  return pool;
}
