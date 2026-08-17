import { z } from "zod";

/**
 * JSON editing format for the entries tab.
 * Images/backgrounds are intentionally NOT part of this format: they are kept
 * as-is on save and can only be edited through the single entry form.
 */

export const entryJsonItem = z.object({
  /** Existing entry id. Omit for new entries; a missing id means "create". */
  id: z.string().uuid().optional(),
  time: z.string().min(1),
  end_time: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  /** Reference ids of rooms (as in the import/export format); empty = all rooms */
  rooms: z.array(z.string().min(1).max(60)).max(50).default([]),
  /** Reference id of a color scheme (as in the import/export format) */
  color_scheme: z.string().max(60).nullable().optional(),
  notify: z.boolean().default(true),
});

export const entriesJsonSchema = z.object({
  entries: z.array(entryJsonItem),
});

export type EntryJsonItem = z.infer<typeof entryJsonItem>;
export type EntriesJson = z.infer<typeof entriesJsonSchema>;

export const ENTRIES_SCHEMA_URI = "https://hackathon-timeline.lovable.app/schema/entries.json";

/** JSON Schema (Draft 07 — the dialect Monaco validates against). */
export function entriesJsonSchemaDoc(roomIds: string[], schemeIds: string[]) {
  return {
    $id: ENTRIES_SCHEMA_URI,
    title: "Timeline entries",
    type: "object",
    additionalProperties: false,
    required: ["entries"],
    properties: {
      entries: {
        type: "array",
        description: "All entries of this tenant. Removing an entry here deletes it.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["time", "title"],
          properties: {
            id: {
              type: "string",
              description:
                "Id of an existing entry. Leave it out to create a new entry — an id is generated on save.",
            },
            time: {
              type: "string",
              description: "Start time, ISO 8601 (e.g. 2026-08-17T09:30:00+02:00)",
            },
            end_time: {
              type: ["string", "null"],
              description: "Optional end time, ISO 8601. The entry stays visible until then.",
            },
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            rooms: {
              type: "array",
              description: "Room reference ids. Empty means the entry is shown in all rooms.",
              items:
                roomIds.length > 0
                  ? { type: "string", enum: roomIds }
                  : { type: "string", minLength: 1, maxLength: 60 },
            },
            color_scheme: {
              type: ["string", "null"],
              description: "Color scheme reference id, or null for the default color.",
              ...(schemeIds.length > 0 ? { enum: [...schemeIds, null] } : {}),
            },
            notify: {
              type: "boolean",
              description: "Post this entry to configured webhooks when it becomes due.",
              default: true,
            },
          },
        },
      },
    },
  };
}

/** Snippet body with a concrete example time, generated at call time. */
export function entrySnippetBody(exampleIso: string): string {
  return [
    "{",
    `  "time": "\${1:${exampleIso}}",`,
    '  "end_time": ${2:null},',
    '  "title": "${3:New entry}",',
    '  "description": "${4:}",',
    "  \"rooms\": [$5],",
    '  "color_scheme": ${6:null},',
    '  "notify": ${7:true}',
    "}$0",
  ].join("\n");
}

/** Local ISO string (with offset) suited for the "time" field. */
export function localIsoNow(date = new Date()): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}
