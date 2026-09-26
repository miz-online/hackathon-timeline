import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { derivePalette } from "@/lib/colors";
import type { PrintableTeam } from "@/components/admin/TeamPrintSheet";

type PrintableRoom = { id: string; color_scheme_id?: string | null };
type PrintableScheme = { id: string; color: string };

function getColumnCount(teamCount: number) {
  if (teamCount <= 1) return 1;
  return Math.min(teamCount, Math.max(2, Math.ceil(Math.sqrt((teamCount * 16) / (9 * 2.6)))));
}

export function TeamGridPrintSheet({
  teams,
  rooms,
  schemes,
  defaultColor,
}: {
  teams: PrintableTeam[];
  rooms: PrintableRoom[];
  schemes: PrintableScheme[];
  defaultColor: string;
}) {
  const { t } = useI18n();
  const columnCount = getColumnCount(teams.length);
  const rowsPerColumn = Math.ceil(teams.length / columnCount);
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    teams.slice(columnIndex * rowsPerColumn, (columnIndex + 1) * rowsPerColumn),
  );

  const colorOf = (team: PrintableTeam) => {
    const room = rooms.find((item) => item.id === team.room_id);
    const scheme = room?.color_scheme_id
      ? schemes.find((item) => item.id === room.color_scheme_id)
      : undefined;
    return scheme?.color ?? defaultColor;
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-4 py-5 sm:px-8 print:block print:min-h-0 print:p-0">
      <div className="mb-4 flex w-full max-w-[1600px] justify-end print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {t("teams.print.action")}
        </Button>
      </div>

      <section
        className="team-grid-sheet aspect-video w-full max-w-[1600px] overflow-hidden border bg-card p-[clamp(0.75rem,2vw,2rem)] print:max-w-none"
        aria-label={t("teams.gridPrint.title")}
      >
        {teams.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("teams.empty")}
          </div>
        ) : (
          <div className="flex h-full">
            {columns.map((column, columnIndex) => (
              <div
                key={columnIndex}
                className="team-grid-column grid min-w-0 flex-1 gap-[clamp(0.25rem,0.65vw,0.75rem)] px-[clamp(0.4rem,0.9vw,1rem)] first:pl-0 last:pr-0"
                style={{ gridTemplateRows: `repeat(${rowsPerColumn}, minmax(0, 1fr))` }}
              >
                {column.map((team, rowIndex) => {
                  const teamIndex = columnIndex * rowsPerColumn + rowIndex;
                  const p = derivePalette(colorOf(team));
                  return (
                    <article
                      key={team.id}
                      className="team-grid-item grid min-h-0 grid-cols-[clamp(2.5rem,5vw,5.5rem)_minmax(0,1fr)] overflow-hidden rounded-[26px] bg-background"
                      style={{ border: `2px solid ${p.base}` }}
                    >
                      <div
                        className="flex items-center justify-center text-[clamp(1rem,2.2vw,2.5rem)] font-semibold"
                        style={{ backgroundColor: p.base, color: p.onBase }}
                      >
                        {teamIndex + 1}
                      </div>
                      <h2 className="flex min-w-0 items-center break-words px-[clamp(0.6rem,1.3vw,1.5rem)] text-[clamp(0.8rem,1.55vw,1.75rem)] font-semibold leading-tight">
                        {team.name}
                      </h2>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        .team-grid-column + .team-grid-column { border-left: 1px solid var(--color-border); }
        @media print {
          html, body { margin: 0 !important; background: transparent !important; }
          .team-grid-sheet {
            width: 100% !important;
            aspect-ratio: 16 / 9 !important;
            border: 0 !important;
            background: transparent !important;
          }
          .team-grid-item { break-inside: avoid; page-break-inside: avoid; }
          .team-grid-column + .team-grid-column { border-left-color: color-mix(in oklab, currentColor 35%, transparent) !important; }
        }
      `}</style>
    </main>
  );
}