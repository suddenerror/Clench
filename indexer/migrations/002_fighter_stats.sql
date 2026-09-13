-- §8 спеки, дословно.
CREATE MATERIALIZED VIEW IF NOT EXISTS fighter_stats AS
SELECT owner,
  COUNT(DISTINCT mint) AS coins,
  SUM(CASE WHEN streak_out>0 THEN 1 ELSE 0 END) AS days_held,
  MAX(streak_out) AS best_streak,
  COUNT(*) FILTER (WHERE streak_in>0 AND streak_out=0) AS breaks,
  MAX(streak_in) FILTER (WHERE streak_out=0) AS worst_break
FROM epoch_holders GROUP BY owner;

-- REFRESH CONCURRENTLY требует уникальный индекс.
CREATE UNIQUE INDEX IF NOT EXISTS fighter_stats_owner_idx ON fighter_stats (owner);
