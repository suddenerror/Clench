import Fastify from "fastify";

// Каркас Фазы 0. Реальные роуты (fighter_stats/эпохи) — Фаза 5.
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
