import { PublicKey } from "@solana/web3.js";
import { getPool } from "../src/db/pool.js";

const MINT = process.env.CALIBRATION_MINT ?? "3GeC4vdVVGuC64oyjQ3oPY7pp8GdAJj8yqovZ3dPpump";

// §2 спеки, дословно.
const PRORATA_BPS = 8000; // 80% пропорционально балансу
const PRIZE_BPS = 10000 - PRORATA_BPS; // 20% с множителем
function multiplier(streak: number): number {
  return Math.min(3.0, 1.0 + 0.1 * streak);
}

async function main() {
  const db = getPool();
  const mintBytes = Buffer.from(new PublicKey(MINT).toBytes());

  const { rows: maxRow } = await db.query(
    `SELECT MAX(epoch_index) AS max_idx FROM epoch_holders WHERE mint = $1`,
    [mintBytes]
  );
  const epochIdx = Number(maxRow[0].max_idx);

  const { rows } = await db.query(
    `SELECT owner, balance_min, streak_out FROM epoch_holders
     WHERE mint = $1 AND epoch_index = $2 AND balance_min > 0
     ORDER BY balance_min DESC`,
    [mintBytes, epochIdx]
  );

  type Row = { owner: string; balance: number; streak: number; weight: number };
  const holders: Row[] = rows.map((r) => {
    const balance = Number(r.balance_min);
    const streak = Number(r.streak_out);
    return { owner: (r.owner as Buffer).toString("hex").slice(0, 8), balance, streak, weight: balance * multiplier(streak) };
  });

  const totalBalance = holders.reduce((s, h) => s + h.balance, 0);
  const totalWeight = holders.reduce((s, h) => s + h.weight, 0);

  const withShares = holders.map((h) => {
    const prorataShare = h.balance / totalBalance; // доля в 80%-слое
    const prizeShare = h.weight / totalWeight; // доля в 20%-слое
    const totalShare = (PRORATA_BPS / 10000) * prorataShare + (PRIZE_BPS / 10000) * prizeShare;
    return { ...h, prorataShare, prizeShare, totalShare };
  });

  withShares.sort((a, b) => b.balance - a.balance);

  console.log(`Эпоха ${epochIdx}, держателей с ненулевым balance_min: ${holders.length}`);
  console.log(`Суммарный баланс (raw units): ${totalBalance.toLocaleString("en-US")}`);
  console.log();

  console.log("--- Топ-5 держателей по размеру позиции ---");
  for (const h of withShares.slice(0, 5)) {
    console.log(
      `owner=${h.owner} balance=${h.balance.toLocaleString("en-US")} streak=${h.streak} ` +
        `mult=${multiplier(h.streak).toFixed(2)}x | доля от общей выплаты=${(h.totalShare * 100).toFixed(2)}%`
    );
  }

  const top1Share = withShares[0].totalShare;
  const top5Share = withShares.slice(0, 5).reduce((s, h) => s + h.totalShare, 0);
  console.log();
  console.log(`Концентрация: топ-1 держатель забирает ${(top1Share * 100).toFixed(2)}% всей выплаты эпохи`);
  console.log(`Топ-5 держателей забирают ${(top5Share * 100).toFixed(2)}% всей выплаты эпохи`);

  // Тест утверждения спеки §2: "холдер с максимальным стриком забирает из
  // призового слоя втрое больше, чем свежий кит ТОЙ ЖЕ позиции".
  console.log();
  console.log("--- Проверка: patient holder vs свежий кит той же позиции ---");
  const medianBalance = withShares[Math.floor(withShares.length / 2)]?.balance ?? 1000;
  const patient = { balance: medianBalance, streak: 20 };
  const freshWhale = { balance: medianBalance, streak: 0 };
  const patientPrizeWeight = patient.balance * multiplier(patient.streak);
  const freshPrizeWeight = freshWhale.balance * multiplier(freshWhale.streak);
  console.log(
    `Одинаковый баланс (${medianBalance.toLocaleString("en-US")}): ` +
      `20-дневный стрик даёт вес=${patientPrizeWeight.toLocaleString("en-US")} (×${multiplier(20).toFixed(1)}), ` +
      `свежий вход даёт вес=${freshPrizeWeight.toLocaleString("en-US")} (×${multiplier(0).toFixed(1)}) — ` +
      `разница ×${(patientPrizeWeight / freshPrizeWeight).toFixed(2)} в призовом слое, ` +
      `подтверждает формулу §2 (потолок ×3.0)`
  );

  // Главный вопрос: "реалистично ли множитель сделать рабочим" — то есть
  // ощутима ли разница в ИТОГОВОЙ выплате (80%+20% вместе), а не только в 20%-слое.
  console.log();
  console.log("--- Итоговый эффект множителя на СУММАРНУЮ выплату (80%+20%) ---");
  const patientTotalShareNum = (PRORATA_BPS / 10000) * (patient.balance / totalBalance) + (PRIZE_BPS / 10000) * (patientPrizeWeight / totalWeight);
  const freshTotalShareNum = (PRORATA_BPS / 10000) * (freshWhale.balance / totalBalance) + (PRIZE_BPS / 10000) * (freshPrizeWeight / totalWeight);
  console.log(
    `При одинаковом балансе итоговая выплата отличается в ×${(patientTotalShareNum / freshTotalShareNum).toFixed(3)} раза ` +
      `(спека обещает "до +40% за одну выдержку" — это множитель ×1.4, здесь фактически ×${(patientTotalShareNum / freshTotalShareNum).toFixed(2)})`
  );

  // Топ-1 держатель против держателя с медианным балансом и максимальным стриком —
  // это то, что реально решает, "работает" ли множитель против доминирования кита.
  const top1 = withShares[0];
  const top1WithMaxStreak = top1.balance * multiplier(20);
  const medianWithMaxStreak = medianBalance * multiplier(20);
  console.log();
  console.log("--- Может ли выдержка обогнать размер позиции? ---");
  console.log(
    `Топ-1 держатель (${top1.balance.toLocaleString("en-US")}, streak=${top1.streak}) против ` +
      `гипотетического держателя с медианным балансом (${medianBalance.toLocaleString("en-US")}) но streak=20: ` +
      `вес топ-1 ${(top1.balance * multiplier(top1.streak)).toLocaleString("en-US")} vs ` +
      `вес медианного-но-терпеливого ${medianWithMaxStreak.toLocaleString("en-US")} — ` +
      `${top1.balance * multiplier(top1.streak) > medianWithMaxStreak ? "размер позиции всё ещё побеждает выдержку" : "выдержка обгоняет размер"}`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
