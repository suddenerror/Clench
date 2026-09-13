import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getPool } from "../src/db/pool.js";

const MINT = process.env.CALIBRATION_MINT ?? "3GeC4vdVVGuC64oyjQ3oPY7pp8GdAJj8yqovZ3dPpump";
const MINT_LABEL = process.env.CALIBRATION_MINT_LABEL ?? "OAI (pump.fun)";
const OUT_PATH = process.env.CALIBRATION_OUT ?? "../docs/calibration-report-v1.md";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const db = getPool();
  const mintBytes = Buffer.from(new PublicKey(MINT).toBytes());

  const { rows: epochCountRows } = await db.query(
    `SELECT COUNT(DISTINCT epoch_index) AS n, MAX(epoch_index) AS max_idx FROM epoch_holders WHERE mint = $1`,
    [mintBytes]
  );
  const epochCount = Number(epochCountRows[0].n);
  const maxEpochIdx = Number(epochCountRows[0].max_idx);

  // Максимальный когда-либо достигнутый стрик на кошелёк — для гистограммы выдержки.
  const { rows: maxStreakRows } = await db.query(
    `SELECT owner, MAX(streak_out) AS max_streak FROM epoch_holders WHERE mint = $1 GROUP BY owner`,
    [mintBytes]
  );
  const totalWallets = maxStreakRows.length;
  const maxStreaks = maxStreakRows.map((r) => Number(r.max_streak));

  const survivorship: { day: number; wallets: number; pct: number }[] = [];
  for (let n = 1; n <= 30; n++) {
    const wallets = maxStreaks.filter((s) => s >= n).length;
    survivorship.push({ day: n, wallets, pct: totalWallets > 0 ? (100 * wallets) / totalWallets : 0 });
  }

  const day20 = survivorship.find((s) => s.day === 20)!;
  const day7 = survivorship.find((s) => s.day === 7)!;

  // Размеры позиций на последней доступной эпохе (конец наблюдаемой истории).
  const { rows: lastEpochRows } = await db.query(
    `SELECT balance_min FROM epoch_holders WHERE mint = $1 AND epoch_index = $2 AND balance_min > 0 ORDER BY balance_min`,
    [mintBytes, maxEpochIdx]
  );
  const positions = lastEpochRows.map((r) => Number(r.balance_min));

  const positionPercentiles = [10, 25, 50, 75, 90, 99].map((p) => ({ p, value: percentile(positions, p) }));

  const findings = {
    mint: MINT,
    mintLabel: MINT_LABEL,
    totalWallets,
    epochsObserved: epochCount,
    survivorship,
    positionPercentiles,
    lastEpochHolderCount: positions.length
  };

  await db.query(
    `INSERT INTO calibration_runs (mint, mint_label, params, findings) VALUES ($1, $2, $3, $4)`,
    [
      mintBytes,
      MINT_LABEL,
      JSON.stringify({ dustToleranceBps: 50, streakCapDays: 20 }),
      JSON.stringify(findings)
    ]
  );

  const discrepancyFlag = day20.pct < 5;

  const md = `# Отчёт калибровки v1

Токен: **${MINT_LABEL}** (\`${MINT}\`), реальные данные mainnet, публичный Solana RPC
(без Helius — исторический батч не требует Yellowstone/webhooks, см. §7 спеки и
Фазу 1.2 плана).

Эпох в наблюдении: **${epochCount}** (посуточно, с момента создания монеты).
Всего уникальных кошельков-держателей за это время: **${totalWallets}**.

## Распределение длительности удержания

Доля кошельков, чей максимальный стрик (при допуске 0.5%, \`dust_tolerance_bps=50\`)
достиг N дней подряд:

| День | Кошельков | Доля |
|---|---|---|
${survivorship
  .filter((s) => [1, 3, 5, 7, 10, 14, 17, 20, 25, 30].includes(s.day))
  .map((s) => `| ${s.day} | ${s.wallets} | ${s.pct.toFixed(2)}% |`)
  .join("\n")}

**Дожили до 7 дней:** ${day7.pct.toFixed(2)}%. **Дожили до текущего порога потолка (20 дней):** ${day20.pct.toFixed(2)}%.

${
  discrepancyFlag
    ? `> ⚠️ **Открытый вопрос к продукту.** До 20 дней дожило меньше 5% кошельков — это
> расхождение с рабочим предположением спеки (условно 15–20%) больше чем на порядок
> в худшую сторону. По правилу Фазы 1 плана (docs/CLENCH-BUILD-PLAN.md) это стоп-сигнал:
> **не продолжать в Фазу 2, пока не будет явного решения** — либо снижать порог/шаг
> множителя, либо принять, что подавляющее большинство холдеров будет получать только
> базовый 80%-слой без множителя, и это осознанный продуктовый выбор.
`
    : `Существенного расхождения с рабочим предположением спеки (порядок величины) не
обнаружено — можно продолжать в Фазу 2 с текущими константами \`multiplier_step_bps=1000\`,
\`multiplier_cap_bps=30000\` (§5 спеки), при условии подтверждения на 2-м и 3-м токенах.
`
}

## Распределение размеров позиций

На последней наблюдаемой эпохе (индекс ${maxEpochIdx}, ${positions.length} держателей
с ненулевым \`balance_min\`), в единицах минимального деноминации токена:

| Перцентиль | Значение (raw units) |
|---|---|
${positionPercentiles.map((p) => `| p${p.p} | ${p.value.toLocaleString("en-US")} |`).join("\n")}

## MIN_PAYOUT — открытый вопрос, требует дополнительных данных

Пункт 1.4(г) плана — «при каком \`MIN_PAYOUT\` доля кошельков, получающих выплату реже
раза в неделю, не превышает 20%» — требует знать **реальный дневной объём налога**,
распределяемого холдерам. У этого токена налога CLENCH никогда не было (это исторический
pump.fun-токен без transfer fee), поэтому прямых данных о размере пула выплат за эпоху
нет и взять их неоткуда без произвольного предположения об обороте/ставке.

**Не додумываю это число.** Корректный путь — либо (а) взять токен, уже торгующийся с
transfer-fee аналогичного размера и посчитать по факту, либо (б) откалибровать
\`MIN_PAYOUT\` вместе с реальным сбором \`harvest_tax\` уже на localnet/devnet в Фазе 2–4,
когда пул выплат считается ончейн, а не предполагается. Оставляю это открытым вопросом
к продукту, а не подставляю произвольную цифру в конфиг.

## Что дальше

- Прогон повторить ещё на 1–2 токенах разного профиля (высокий/низкий объём) для
  подтверждения устойчивости вывода о выживаемости стриков — см. \`calibration_runs\`
  в БД для истории прогонов.
- \`MIN_PAYOUT\` закрыть в Фазе 4 (кипер) на реальных \`harvest_tax\` данных, не раньше.
`;

  writeFileSync(new URL(OUT_PATH, import.meta.url), md, "utf-8");
  console.log(`[calibration-report] written to ${OUT_PATH}`);
  console.log(JSON.stringify(findings, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
