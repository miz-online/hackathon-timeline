import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { getTeamSelfUrl } from "@/lib/files.functions";

/** Shows the self-management link of a team with a QR code. */
export function TeamLinkDialog({
  tenantKey,
  team,
  onClose,
}: {
  tenantKey: string;
  team: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const urlFn = useServerFn(getTeamSelfUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!team) {
      setUrl(null);
      setMissing(false);
      setQr(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const r = await urlFn({ data: { key: tenantKey, teamId: team.id } });
        if (!active) return;
        if ("reason" in r) {
          setMissing(true);
          return;
        }
        const full = `${window.location.origin}${r.path}`;
        setUrl(full);
        const { toDataURL } = await import("qrcode");
        const png = await toDataURL(full, { width: 320, margin: 1 });
        if (active) setQr(png);
      } catch (e) {
        if (active) toast.error((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [team, tenantKey, urlFn]);

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{team ? `${t("teams.link")} — ${team.name}` : t("teams.link")}</DialogTitle>
        </DialogHeader>
        {missing ? (
          <p className="text-sm text-muted-foreground">{t("teams.linkMissing")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("teams.linkQr")}</p>
            <div className="flex gap-2">
              <Input readOnly value={url ?? ""} />
              <Button
                size="icon"
                variant="secondary"
                disabled={!url}
                aria-label={t("teams.copyEditLink")}
                onClick={async () => {
                  if (!url) return;
                  await navigator.clipboard.writeText(url);
                  toast.success(t("teams.copyEditLink"));
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {qr ? (
              <div className="flex justify-center rounded-md border bg-background p-3">
                <img src={qr} alt="QR" className="h-48 w-48" />
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
