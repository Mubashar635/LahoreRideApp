import type { Queryable } from './queryable';

export async function riderExists(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query('SELECT 1 FROM riders WHERE id = $1', [id]);
  return rowCount === 1;
}
