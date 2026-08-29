import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { Shell } from "./$token";
import { getRegistration, submitRegistration } from "@/lib/registration.functions";

export const Route = createFileRoute("/tr/$token/")({
  ssr: false,
  component: RegisterPage,
  head: () => ({
    meta: [
      { title: "Team registration" },
      { name: "description", content: "Register your hackathon team for the schedule." },
      { property: "og:title", content: "Team registration" },
      {
        property: "og:description",
        content: "Register your hackathon team for the schedule.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Info = Awaited<ReturnType<typeof getRegistration>>;

function RegisterPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [project, setProject] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getRegistration({ data: { token } }).then(setInfo);
  }, [token]);

  if (!info) return <Shell>&nbsp;</Shell>;
  if (!info.found) return <Shell title={t("reg.closedTitle")}>{t("reg.unknown")}</Shell>;
  if (!info.open)
    return (
      <Shell
        title={t("reg.closedTitle")}
        tenantName={info.tenantName}
        logoUrl={info.logoUrl}
        logoHeight={info.logoHeight}
      >
        {t("reg.closedBody")}
      </Shell>
    );

  return (
    <Shell
      title={t("reg.formTitle")}
      tenantName={info.tenantName}
      logoUrl={info.logoUrl}
      logoHeight={info.logoHeight}
    >
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
        <Button
          disabled={saving || !name.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              const { code } = await submitRegistration({
                data: { token, name, members, project },
              });
              navigate({ to: "/tr/$token/$code", params: { token, code } });
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t("reg.saving") : t("reg.submit")}
        </Button>
      </div>
    </Shell>
  );
}
