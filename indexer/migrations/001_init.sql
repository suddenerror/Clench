-- Фаза 1.1 — схема БД. balance_events дословно по §7 спеки.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Спека (§7) задаёт PRIMARY KEY (mint, owner, slot), но TimescaleDB требует,
-- чтобы partitioning-колонка (block_time) входила в любой уникальный ключ
-- гипертаблицы. slot однозначно определяет block_time, так что семантика
-- не меняется — расширяем ключ на block_time исключительно из-за этого
-- ограничения хранилища.
CREATE TABLE IF NOT EXISTS balance_events (
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  mint BYTEA NOT NULL,
  owner BYTEA NOT NULL,
  balance NUMERIC(39) NOT NULL,
  PRIMARY KEY (mint, owner, slot, block_time)
);

SELECT create_hypertable('balance_events', 'block_time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS balance_events_mint_owner_time_idx
  ON balance_events (mint, owner, block_time DESC);

-- Один держатель на одну эпоху жизни монеты. min_balance_epoch — минимум
-- за окно (§7, "ловушка открывающего баланса"), streak — по правилу §2.
CREATE TABLE IF NOT EXISTS epoch_holders (
  mint BYTEA NOT NULL,
  owner BYTEA NOT NULL,
  epoch_index INT NOT NULL,
  epoch_start TIMESTAMPTZ NOT NULL,
  epoch_end TIMESTAMPTZ NOT NULL,
  balance_open NUMERIC(39) NOT NULL,
  balance_min NUMERIC(39) NOT NULL,
  streak_in INT NOT NULL,
  streak_out INT NOT NULL,
  PRIMARY KEY (mint, owner, epoch_index)
);

CREATE INDEX IF NOT EXISTS epoch_holders_mint_epoch_idx
  ON epoch_holders (mint, epoch_index);

-- Результаты прогонов калибровки (Фаза 1.4), для истории/сравнения.
CREATE TABLE IF NOT EXISTS calibration_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mint BYTEA NOT NULL,
  mint_label TEXT,
  params JSONB NOT NULL,
  findings JSONB NOT NULL
);
