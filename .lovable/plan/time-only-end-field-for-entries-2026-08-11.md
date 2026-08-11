# Time-only "End" field for entries

## Goal

In the entry dialog, the "End" field currently accepts a full date+time (`datetime-local`). Change it so only the **time** is entered; the date always comes from the start time's date. No duration field will be added.

## Requirements (from user answers)

- End input is **time-only** (hh:mm). Its date is always the start time's date.
- If the entered end time would cross midnight (end time earlier than start time on the same date), **auto-roll to the next day**.
- Do **not** implement a duration/length field. Time entry is feasible, so it's the only mechanism.

## Change

Single file: `src/routes/tenant/$tenantKey/index.tsx` — the `EntryForm` component (and its `toLocalInput` usage for the end field).

1. **Input field** — Change the end input from `type="datetime-local"` to `type="time"` (value `hh:mm`, placeholder `HH:MM`). The start field stays `datetime-local`.
2. **Initial value** — When editing an existing entry, seed the time-only field from `initial.end_time` formatted as `hh:mm` (reuse the existing `pad` helper; do not reuse `toLocalInput`, which includes the date).
3. **Save computation** — On submit, build the end timestamp from the start time's date plus the entered hours/minutes:
   - Parse the start date from the `time` field.
   - Apply the end hours/minutes to that date.
   - If the resulting instant is `<=` start instant, add 24h (roll to next day) so late events crossing midnight work.
   - Store as ISO string in `end_time` (existing column, unchanged).
4. **Validation** — Remove/relax the current `endTimeAfterStart` error, since crossing midnight is now valid by auto-roll. Keep the "clear end" path (empty field → `end_time: null`).

No schema changes. Storage, admin list, room template, filters, snapshot/stream APIs, and import/export all keep working because `end_time` remains a full ISO timestamp.

## Out of scope

- No duration field.
- No changes to display/template or filtering logic.
