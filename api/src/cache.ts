// §5 плана: «API поверх epoch_holders/fighter_stats… только чтение, всё
// кешируется». Простой in-memory TTL-кеш — этого достаточно для read-only
// API поверх материализованных/агрегированных данных, которые и так не
// меняются чаще, чем раз в эпоху/раунд.
const store = new Map<string, { value: unknown; expiresAt: number }>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
