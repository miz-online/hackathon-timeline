import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { Shell } from "./$token";
import { getRegisteredTeam, updateRegisteredTeam } from "@/lib/registration.functions";

export const Route = createFileRoute("/tr/$token/$code")({
  ssr: false,
  component: EditTeamPage,
  head: () => ({
    meta: [
      { title: "Edit your team" },
      { name: "description", content: "Update your hackathon team registration." },
      { property: "og:title", content: "Edit your team" },
      { property: "og:description", content: "Update your hackathon team registration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Info = Awaited<ReturnType<typeof getRegisteredTeam>>;

const seenKey = (code: string) => `tr-seen:${code}`;

function EditTeamPage() {
  const { token, code } = Route.useParams();
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [project, setProject] = useState("");
  const [roomId, setRoomId] = useState("");
  const [saving, setSaving] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    void getRegisteredTeam({ data: { token, code } }).then((r) => {
      setInfo(r);
      if (r.found) {
        setName(r.team.name);
        setMembers(r.team.members);
        setProject(r.team.project);
        setRoomId(r.team.room_id ?? "");
        const key = seenKey(code);
        if (typeof window !== "undefined" && !window.localStorage.getItem(key)) {
          setShowWelcome(true);
          window.localStorage.setItem(key, "1");
        }
      }
    });
  }, [token, code]);

  const editUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tr/${token}/${code}`
      : `/tr/${token}/${code}`;

  if (!info) return <Shell>&nbsp;</Shell>;
  if (!info.found) return <Shell title={t("reg.closedTitle")}>{t("reg.unknown")}</Shell>;
  if (info.locked)
    return (
      <Shell
        title={t("reg.editTitle")}
        tenantName={info.tenantName}
        logoUrl={info.logoUrl}
        logoHeight={info.logoHeight}
      >
        {t("reg.lockedBody")}
      </Shell>
    );

  return (
    <Shell
      title={t("reg.editTitle")}
      tenantName={info.tenantName}
      logoUrl={info.logoUrl}
      logoHeight={info.logoHeight}
    >
      <div className="space-y-4">
        {showWelcome && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
            <h3 className="mb-1 font-semibold text-foreground">{t("reg.welcomeTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground">{t("reg.welcomeBody")}</p>
            <ShareLink url={editUrl} />
            <p className="mt-3 text-xs text-muted-foreground">{t("reg.bookmarkHint")}</p>
          </div>
        )}

        {!showWelcome && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowShare((s) => !s)}>
              {showShare ? t("reg.hideShare") : t("reg.showShare")}
            </Button>
          </div>
        )}

        {showShare && !showWelcome && <ShareLink url={editUrl} />}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("reg.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("reg.members")}</Label>
            <Input
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              placeholder={t("reg.membersPh")}
            />
            <p className="text-xs text-muted-foreground">{t("reg.membersHint")}</p>
          </div>
          <div className="space-y-1">
            <Label>{t("reg.project")}</Label>
            <Textarea rows={5} value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("reg.room")}</Label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">{t("reg.noRoom")}</option>
              {info.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await updateRegisteredTeam({
                  data: { token, code, name, members, project, room_id: roomId || null },
                });
                toast.success(t("reg.saved"));
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t("reg.saving") : t("reg.save")}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function ShareLink({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} className="font-mono text-xs" />
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          toast.success(t("reg.copied"));
        }}
      >
        {t("reg.copy")}
      </Button>
    </div>
  );
}
