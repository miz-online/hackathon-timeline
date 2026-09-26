import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type PrintableTeam = {
  id: string;
  name: string;
  members: string;
  project: string;
  room_id: string | null;
};

type PrintableRoom = { id: string; name: string; color_scheme_id?: string | null };
type PrintableScheme = { id: string; color: string };

export function TeamPrintSheet({
  tenantName,
  teams,
  rooms,
  schemes,
  defaultColor,
}: {
  tenantName: string;
  teams: PrintableTeam[];
  rooms: PrintableRoom[];
  schemes: PrintableScheme[];
  defaultColor: string;
}) {
  const { t } = useI18n();
  const colorOf = (team: PrintableTeam) => {
    const room = rooms.find((item) => item.id === team.room_id);
    const scheme = room?.color_scheme_id
      ? schemes.find((item) => item.id === room.color_scheme_id)
      : undefined;
    return scheme?.color ?? defaultColor;
  };

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-background px-4 py-5 sm:px-8 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {t("teams.print.action")}
        </Button>
      </div>
      <section className="team-print-sheet border bg-card p-6 sm:p-8" aria-label={t("teams.print.title")}>
        <header className="team-print-header mb-6 border-b pb-4">
          <p className="text-sm text-muted-foreground">{tenantName}</p>
          <h1 className="text-2xl font-semibold">{t("teams.print.title")}</h1>
        </header>
        {teams.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("teams.empty")}</p>
        ) : (
          <div className="team-print-grid grid grid-cols-1 gap-3 sm:grid-cols-2">
            {teams.map((team, idx) => {
              const roomName = rooms.find((room) => room.id === team.room_id)?.name;
              return (
                <article key={team.id} className="team-print-item grid grid-cols-[auto_minmax(0,1fr)] gap-3 border p-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground"
                    style={{ backgroundColor: colorOf(team) }}
                  >
                    {idx + 1}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div>
                      <h2 className="break-words text-base font-semibold leading-tight">{team.name}</h2>
                      {roomName ? <p className="text-xs text-muted-foreground">{roomName}</p> : null}
                    </div>
                    {team.members ? (
                      <div>
                        <p className="text-[10px] font-medium uppercase text-muted-foreground">{t("teams.hover.members")}</p>
                        <p className="break-words text-sm leading-snug">{team.members}</p>
                      </div>
                    ) : null}
                    {team.project ? (
                      <div>
                        <p className="text-[10px] font-medium uppercase text-muted-foreground">{t("teams.hover.project")}</p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-snug">{team.project}</p>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          body { background: transparent !important; }
          .team-print-sheet { border: 0 !important; padding: 0 !important; background: transparent !important; color: black !important; }
          .team-print-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 3mm !important; }
          .team-print-item { break-inside: avoid; page-break-inside: avoid; border-color: color-mix(in oklab, currentColor 25%, transparent) !important; }
          .team-print-header { border-color: color-mix(in oklab, currentColor 40%, transparent) !important; }
        }
      `}</style>
    </main>
  );
}