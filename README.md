# CLENCH

Лаунчпад на Solana, где торговый налог автоматически уходит холдерам, и чем дольше держишь монету, тем больше получаешь.

- Продукт и экономика: [docs/CLENCH-spec.md](docs/CLENCH-spec.md) — источник истины.
- План реализации по фазам: [docs/CLENCH-BUILD-PLAN.md](docs/CLENCH-BUILD-PLAN.md).

## Структура

```
/program   — Anchor-программа (Rust)
/indexer   — TypeScript, Postgres, Helius
/keeper    — TypeScript, воркер
/api       — Fastify
/web       — Next.js
/docs      — спека, план, ADR
```

## Окружение

```bash
docker-compose up -d
```

Поднимает Postgres 16 с расширением TimescaleDB на `localhost:5432` (см. `docker-compose.yml`).

Каждый сервис имеет свой `.env.example` — скопируйте в `.env` и заполните перед запуском.

Требуются `solana` CLI и `anchor` (Anchor 0.30.x) для работы с `/program`.
