// §2 спеки, дословно.
export function multiplier(streak: number, isOg: boolean): number {
  return isOg ? Math.min(4.0, 1.0 + 0.15 * streak) : Math.min(3.0, 1.0 + 0.1 * streak);
}

export function daysToCap(streak: number, isOg: boolean): number {
  const cap = isOg ? 20 : 20; // срок до потолка одинаков (§2)
  return Math.max(0, cap - streak);
}
