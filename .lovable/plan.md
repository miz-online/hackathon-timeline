# Optional end time for entries

Add an optional end time to time entries. When set, it controls how long the entry stays visible instead of the global display grace period, and it is shown below the start time on the room display.

## Behaviour

**Admin (Entries tab)**
- New optional "End time" field in the entry editor (datetime-local), next to/below the start time.
- Empty = no end time (current behaviour).
- Validation: end time must be after the start time; otherwise the save button stays disabled with a hint.

**Visibility**
- Entry without end time: hidden once start time + configured grace minutes has passed (unchanged).
- Entry with end time: hidden once the end time has passed (grace setting is ignored for it).
- Applies to the room display, the SSE/snapshot feed, and the expired/active split in the admin entries list.

**Room display (Zeitplan template), time column**
- More than 15 min away: start `hh:mm` on top, end `hh:mm` below in the smaller dimmed style.
- Less than 15 min away: `in 5 min` on top, subtitle `hh:mm - hh:mm` (start - end).
- Currently running (NOW): `NOW` / `JETZT` on top, subtitle `bis hh:mm` ("until hh:mm" in English).
- Entries without end time look exactly as today.

**Import / Export**
- `end_time` added to the exported entry objects and the bundled JSON schema (optional field), and read back on import; older exports without it keep working.

## Technical notes

- Migration: add nullable `end_time timestamptz` to `public.entries`. The existing `entries_reset_notified_at` trigger keeps reacting to `time` only (webhook posting stays tied to the start time).
- `src/lib/board.functions.ts`: include `end_time` in selects, entry types, create/update validators, and change `filterVisible` cutoff logic to `end_time ?? time + grace`.
- `src/components/templates/ZeitplanTemplate.tsx`: extend the `Entry` type and the three time-column render branches; "NOW" state becomes `time <= now < end` for entries with an end time.
- `src/routes/tenant/$tenantKey/index.tsx`: end-time input in the entry form, and use the same cutoff rule for the expired filter and the pulsing "now" icon.
- `src/lib/i18n.tsx`: new keys `display.untilTime` ("until {time}" / "bis {time}") and `entries.form.endTime`.
- `src/lib/tenant-io.ts`: export/import/schema for `end_time`.
