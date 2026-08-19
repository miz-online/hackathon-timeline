/**
 * Practice ("Übungszeit") entries.
 *
 * A practice entry is a single stored entry that stands for the whole practice
 * block. For display it is expanded into one row per team: every team gets a
 * slot of `practiceMinutes`, in team order, starting at the entry's time.
 * The stored entry therefore has no description, no room tags and no color
 * scheme — colors come from the room a team is assigned to.
 */

export const ENTRY_KINDS = ["entry", "practice"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const PRACTICE_SCOPES = ["assigned", "all"] as const;
export type PracticeScope = (typeof PRACTICE_SCOPES)[number];

export type PracticeTeam = {
  id: string;
  name: string;
  room_id: string | null;
  /** Color of the assigned room's scheme, or null for the default color. */
  color: string | null;
};

type ExpandableEntry = {
  id: string;
  kind?: string | null;
  time: string;
  end_time: string | null;
  title: string;
  description: string;
  tags: string[];
  color: string | null;
  team_id?: string | null;
};

/** End time of a practice block: start + teams × minutes. */
export function practiceEndTime(startIso: string, teamCount: number, minutes: number): string {
  const start = new Date(startIso).getTime();
  return new Date(start + Math.max(0, teamCount) * Math.max(1, minutes) * 60_000).toISOString();
}

/**
 * Replaces practice entries with one entry per team. All other entries are
 * returned unchanged. Slot times always follow the full team order, so hiding
 * teams of other rooms never shifts the schedule.
 */
export function expandPracticeEntries<T extends ExpandableEntry>(
  entries: T[],
  opts: {
    teams: PracticeTeam[];
    practiceMinutes: number;
    scope: string;
    /** Room the display is rendered for; "overview" shows every team. */
    roomId: string;
    isOverview: boolean;
  },
): T[] {
  const minutes = Math.max(1, opts.practiceMinutes || 10);
  const out: T[] = [];
  for (const e of entries) {
    if ((e.kind ?? "entry") !== "practice") {
      out.push(e);
      continue;
    }
    const start = new Date(e.time).getTime();
    opts.teams.forEach((team, idx) => {
      const onlyAssigned = opts.scope === "assigned";
      if (!opts.isOverview && onlyAssigned && team.room_id && team.room_id !== opts.roomId) return;
      out.push({
        ...e,
        id: `${e.id}:${team.id}`,
        team_id: team.id,
        time: new Date(start + idx * minutes * 60_000).toISOString(),
        end_time: new Date(start + (idx + 1) * minutes * 60_000).toISOString(),
        title: team.name,
        description: "",
        color: team.color ?? e.color,
      });
    });
  }
  return out;
}
