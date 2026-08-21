import { z } from "zod";

/**
 * JSON editing format for the teams tab. The array order is the display order
 * of the teams (which drives the team time slots).
 */

export const teamJsonItem = z.object({
  /** Existing team id. Omit for new teams; a missing id means "create". */
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  /** Reference id used in the import/export format; derived from the name when omitted. */
  ref_id: z.string().max(60).nullable().optional(),
  members: z.string().max(2000).default(""),
  project: z.string().max(4000).default(""),
  /** Reference id of a room, or null for "not assigned". */
  room: z.string().max(60).nullable().optional(),
});

export const teamsJsonSchema = z.object({
  teams: z.array(teamJsonItem),
});

export type TeamJsonItem = z.infer<typeof teamJsonItem>;
export type TeamsJson = z.infer<typeof teamsJsonSchema>;

export const TEAMS_SCHEMA_URI = "https://hackathon-timeline.lovable.app/schema/teams.json";

/** JSON Schema (Draft 07 — the dialect Monaco validates against). */
export function teamsJsonSchemaDoc(roomIds: string[]) {
  return {
    $id: TEAMS_SCHEMA_URI,
    title: "Teams",
    type: "object",
    additionalProperties: false,
    required: ["teams"],
    properties: {
      teams: {
        type: "array",
        description:
          "All teams of this tenant, in display order. Removing a team here deletes it.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            id: {
              type: "string",
              description:
                "Id of an existing team. Leave it out to create a new team — an id is generated on save.",
            },
            name: { type: "string", minLength: 1, maxLength: 120 },
            ref_id: {
              type: ["string", "null"],
              description: "Export reference id. Derived from the name when null.",
            },
            members: {
              type: "string",
              description: "Comma separated participant names.",
              maxLength: 2000,
            },
            project: { type: "string", description: "Project description.", maxLength: 4000 },
            room: {
              type: ["string", "null"],
              description: "Room reference id, or null when the team is not assigned to a room.",
              ...(roomIds.length > 0 ? { enum: [...roomIds, null] } : {}),
            },
          },
        },
      },
    },
  };
}

/** Snippet body for a new team. */
export function teamSnippetBody(): string {
  return [
    "{",
    '  "name": "${1:New team}",',
    '  "ref_id": ${2:null},',
    '  "members": "${3:}",',
    '  "project": "${4:}",',
    '  "room": ${5:null}',
    "}$0",
  ].join("\n");
}
