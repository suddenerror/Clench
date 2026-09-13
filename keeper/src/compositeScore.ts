import type { Pool } from "pg";

// §3 «Счёт раунда», упрощённая версия для Фазы 4: mcap с поправкой на
// ликвидность не считается — нет ончейн-оракула цены/ликвидности пула
// (бондинг-кривая/AMM вне скоупа этой фазы, см. Фазу 2). Вес w_mcap_bps
// эффективно перераспределяется между объёмом и держателями. Это
// задокументированное упрощение, не молчаливая недоделка — см.
// docs/CLENCH-BUILD-PLAN.md Фаза 4.
export async function computeCompositeScore(
  db: Pool,
  mint: Buffer,
  windowStart: Date,
  windowEnd: Date,
  minHolderBalance: bigint
): Promise<number> {
  // Направленный оборот на кошелёк: net + 0.1*churn, потолок 5% от объёма
  // раунда (§3, дословно), из balance_events за окно раунда.
  const { rows: deltaRows } = await db.query(
    `SELECT owner,
            MAX(balance) - MIN(balance) AS spread,
            COUNT(*) AS events
     FROM balance_events
     WHERE mint = $1 AND block_time >= $2 AND block_time < $3
     GROUP BY owner`,
    [mint, windowStart, windowEnd]
  );

  let totalVolume = 0;
  const contributions: number[] = [];
  for (const row of deltaRows) {
    // Прокси direction-агностичный: без знака сделки берём модуль изменения
    // как net (недооценка churn, но это верхняя граница волатильности).
    const spread = Number(row.spread);
    contributions.push(spread);
    totalVolume += spread;
  }
  const cap = totalVolume * 0.05;
  const cleanVolume = contributions.reduce((sum, c) => sum + Math.min(c, cap || c), 0);

  const { rows: holderRows } = await db.query(
    `SELECT COUNT(*) AS n FROM (
       SELECT owner FROM balance_events
       WHERE mint = $1 AND block_time < $3
       GROUP BY owner HAVING MAX(balance) >= $4
     ) t`,
    [mint, windowStart, windowEnd, minHolderBalance.toString()]
  );
  const holders = Math.sqrt(Number(holderRows[0]?.n ?? 0)); // убывающая отдача (§3)

  // §3 веса, mcap перераспределён поровну между volume/holders в этой
  // упрощённой версии (0.5+0.1=0.6 volume, 0.3+0.1=0.4 holders).
  return 0.6 * cleanVolume + 0.4 * holders * 1000; // масштаб держателей — эвристика для сопоставимости с объёмом
}
