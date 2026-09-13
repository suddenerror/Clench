import { config } from "./config.js";

// §4: алертинг на любой Underfunded/OverPromise реджект — это должно быть
// невозможно, но если случилось, это критический сигнал.
export async function alertCritical(message: string, context: Record<string, unknown> = {}): Promise<void> {
  console.error(`[CRITICAL] ${message}`, context);
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, context, at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error("[alert] failed to deliver webhook", err);
  }
}
