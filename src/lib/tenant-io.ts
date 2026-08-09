import { z } from "zod";

export const IO_VERSION = 3;

export const SECTIONS = [
  "tenant",
  "color_schemes",
  "rooms",
  "entries",
  "ad_sets",
  "ads",
  "webhooks",
  "logo",
] as const;
export type Section = (typeof SECTIONS)[number];

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** "zeitplan", "ads" (first set) or "ads:<ad set reference id>" */
export const templateRef = z.string().min(1).max(80);

export const tenantSection = z.object({
  name: z.string().min(1).max(120),
  past_grace_minutes: z.number().int().min(0).max(1440),
  template: templateRef,
  logo_height: z.number().int().min(16).max(400),
  accent_color: hexColor,
  ad_seconds: z.number().int().min(1).max(600),
});

export const colorSchemeItem = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  color: hexColor,
});

export const roomItem = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  template: templateRef.nullable().default(null),
  color_scheme: z.string().max(60).nullable().default(null),
});

export const entryItem = z.object({
  time: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  rooms: z.array(z.string().min(1).max(60)).max(50).default([]),
  color_scheme: z.string().max(60).nullable().default(null),
  notify: z.boolean().default(true),
});

export const adSetItem = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  ad_seconds: z.number().int().min(1).max(600).default(10),
});

export const adItem = z.object({
  name: z.string().min(1).max(120),
  file: z.string().min(1).max(300),
  content_type: z.string().min(1).max(100).default("image/png"),
  /** id of an entry in ad_sets; null falls back to the first set */
  set: z.string().max(60).nullable().default(null),
});

export const webhookItem = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  type: z.enum(["discord"]).default("discord"),
  enabled: z.boolean().default(true),
  /** Never exported (always null). When null on import the URL is not set. */
  url: z.string().max(500).nullable().default(null),
});

export const logoSection = z.object({
  file: z.string().min(1).max(300),
  content_type: z.string().min(1).max(100).default("image/png"),
});

/** All top level sections are optional so partial import files validate too. */
export const tenantDataSchema = z.object({
  version: z.number().int().optional(),
  exported_at: z.string().optional(),
  tenant: tenantSection.optional(),
  color_schemes: z.array(colorSchemeItem).optional(),
  rooms: z.array(roomItem).optional(),
  entries: z.array(entryItem).optional(),
  ad_sets: z.array(adSetItem).optional(),
  ads: z.array(adItem).optional(),
  webhooks: z.array(webhookItem).optional(),
  logo: logoSection.nullable().optional(),
});


export type TenantData = z.infer<typeof tenantDataSchema>;

export const DATA_FILENAME = "tenant-data.json";
export const SCHEMA_FILENAME = "tenant-schema.json";

/** JSON Schema (Draft 2020-12) describing the export/import format. */
export const TENANT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://hackathon-timeline.lovable.app/schema/tenant-data.json",
  title: "Timeline tenant data",
  description:
    "Import/export format for a tenant. Every top level section is optional so that partial imports can be validated with this schema as well.",
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "integer", description: "Format version", default: IO_VERSION },
    exported_at: { type: "string", format: "date-time" },
    tenant: {
      type: "object",
      description: "Organization wide settings",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        past_grace_minutes: { type: "integer", minimum: 0, maximum: 1440 },
        template: {
          type: "string",
          description: '"zeitplan", "ads" (first ad set) or "ads:<ad set id>"',
        },

        logo_height: { type: "integer", minimum: 16, maximum: 400 },
        accent_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        ad_seconds: { type: "integer", minimum: 1, maximum: 600 },
      },
    },
    color_schemes: {
      type: "array",
      description: "Named colors, referenced by rooms and entries via their id",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "color"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 60,
            description: "Reference id, derived from the name when not set explicitly",
          },
          name: { type: "string", minLength: 1, maxLength: 120 },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 60, description: "Reference id" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          template: {
            type: ["string", "null"],
            description:
              'Overrides the organization template: "zeitplan", "ads" or "ads:<ad set id>"',
          },

          color_scheme: {
            type: ["string", "null"],
            description: "id of an entry in color_schemes",
          },
        },
      },
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["time", "title"],
        properties: {
          time: { type: "string", format: "date-time" },
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          rooms: {
            type: "array",
            description: "ids of rooms this entry is shown in; empty means all rooms",
            items: { type: "string", minLength: 1, maxLength: 60 },
          },
          color_scheme: {
            type: ["string", "null"],
            description: "id of an entry in color_schemes",
          },
          notify: {
            type: "boolean",
            description: "Whether to post this entry to configured webhooks at its due time",
            default: true,
          },
        },
      },
    },
    ad_sets: {
      type: "array",
      description: "Ad sets; a display template selects one of them",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 60,
            description: "Reference id, derived from the name when not set explicitly",
          },
          name: { type: "string", minLength: 1, maxLength: 120 },
          ad_seconds: {
            type: "integer",
            minimum: 1,
            maximum: 600,
            description: "Display duration per ad in this set",
          },
        },
      },
    },
    ads: {
      type: "array",
      description: "Images shown by the ads template, in display order",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "file"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          file: {
            type: "string",
            description: "Path of the image inside the export archive, e.g. images/ads/01-logo.png",
          },
          content_type: { type: "string" },
          set: {
            type: ["string", "null"],
            description: "id of an entry in ad_sets; null uses the first set",
          },
        },
      },
    },

    webhooks: {
      type: "array",
      description: "Webhook targets for automatic and manual messages. URLs are never exported.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 60,
            description: "Reference id, derived from the name when not set explicitly",
          },
          name: { type: "string", minLength: 1, maxLength: 120 },
          type: { type: "string", enum: ["discord"], default: "discord" },
          enabled: { type: "boolean", default: true },
          url: {
            type: ["string", "null"],
            description:
              "Webhook URL. Always null in exports; when null on import the URL is left unset and the webhook stays inactive.",
            default: null,
          },
        },
      },
    },
    logo: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["file"],
      properties: {
        file: { type: "string", description: "Path of the logo inside the export archive" },
        content_type: { type: "string" },
      },
    },
  },
} as const;

export const VSCODE_SETTINGS = {
  "json.schemas": [
    {
      fileMatch: [DATA_FILENAME, `/${DATA_FILENAME}`, "*.tenant.json"],
      url: `./${SCHEMA_FILENAME}`,
    },
  ],
};
