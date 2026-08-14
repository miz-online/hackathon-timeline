import { derivePalette } from "@/lib/colors";

export type WebhookType = "discord";

export type WebhookImage = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type WebhookMessage = {
  title: string;
  description: string;
  time?: Date;
  endTime?: Date | null;
  color?: string | null;
  /** optional image, appended at the end of the message as an attachment */
  image?: WebhookImage | null;
};

export function buildDiscordPayload(message: WebhookMessage): {
  username?: string;
  embeds: {
    title: string;
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    image?: { url: string };
  }[];
} {
  const colorHex = message.color ? derivePalette(message.color).base : undefined;
  const color = colorHex ? parseInt(colorHex.replace("#", ""), 16) : undefined;

  const title = message.time
    ? `<t:${Math.floor(message.time.getTime() / 1000)}:t>: ${message.title}`
    : message.title;

  const embed: {
    title: string;
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    image?: { url: string };
  } = {
    title,
    description: message.description || undefined,
  };

  if (color) embed.color = color;
  if (message.image) {
    embed.image = { url: `attachment://${sanitizeFilename(message.image.filename)}` };
  }

  return { embeds: [embed] };
}

function sanitizeFilename(name: string): string {
  const clean = (name || "image").replace(/[^A-Za-z0-9._-]/g, "_");
  return /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.png`;
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
    let res: Response;
    if (message.image) {
      const name = sanitizeFilename(message.image.filename);
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      form.append(
        "files[0]",
        new Blob([message.image.bytes as unknown as BlobPart], {
          type: message.image.contentType || "image/png",
        }),
        name,
      );
      res = await fetch(url, { method: "POST", body: form });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }


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
