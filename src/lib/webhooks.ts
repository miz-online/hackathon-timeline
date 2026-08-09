import { derivePalette } from "@/lib/colors";

export type WebhookType = "discord";

export type WebhookMessage = {
  title: string;
  description: string;
  time?: Date;
  color?: string | null;
};

export function buildDiscordPayload(message: WebhookMessage): {
  username?: string;
  embeds: {
    title: string;
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
  }[];
} {
  const colorHex = message.color ? derivePalette(message.color).base : undefined;
  const color = colorHex ? parseInt(colorHex.replace("#", ""), 16) : undefined;

  const title = message.time
    ? `${message.time.toLocaleString([], { timeStyle: "short" })}: ${message.title}`
    : message.title;

  const embed: {
    title: string;
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
  } = {
    title,
    description: message.description || undefined,
  };

  if (color) embed.color = color;

  return { embeds: [embed] };
}

export async function sendWebhook(
  url: string,
  type: WebhookType,
  message: WebhookMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (type !== "discord") {
    return { ok: false, error: `Unsupported webhook type: ${type}` };
  }

  const payload = buildDiscordPayload(message);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        // ignore
      }
      return { ok: false, error: `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
