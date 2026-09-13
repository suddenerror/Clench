// §4: ретраи с экспонентой на все permissionless-инструкции, идемпотентность
// (не дублировать harvest_tax, если предыдущий вызов не подтверждён).

const inFlight = new Set<string>();

export async function withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (inFlight.has(key)) {
    console.warn(`[idempotency] skip — already in flight: ${key}`);
    return undefined;
  }
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { label: string; maxAttempts?: number; baseDelayMs?: number } = { label: "job" }
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`[retry] ${opts.label} failed (attempt ${attempt}/${maxAttempts}): ${(err as Error).message}. Retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
