import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { getRegistration, submitRegistration } from "@/lib/registration.functions";
import defaultLogo from "@/assets/pit-hackathon-logo.png.asset.json";

export const Route = createFileRoute("/tr/$token")({
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
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [project, setProject] = useState("");
  const [saving, setSaving] = useState(false);
  const [doneCode, setDoneCode] = useState<string | null>(null);

  useEffect(() => {
    void getRegistration({ data: { token } }).then(setInfo);
  }, [token]);

  if (!info) return <Shell>&nbsp;</Shell>;
  if (!info.found)
    return (
      <Shell title={t("reg.closedTitle")}>{t("reg.unknown")}</Shell>
    );
  if (!info.open && !doneCode)
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

  if (doneCode) {
    const url = `${window.location.origin}/tr/${token}/${doneCode}`;
    return (
      <Shell
        title={t("reg.doneTitle")}
        tenantName={info.tenantName}
        logoUrl={info.logoUrl}
        logoHeight={info.logoHeight}
      >
        <p className="mb-3 text-sm text-muted-foreground">{t("reg.doneBody")}</p>
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
        <a className="mt-4 inline-block text-sm underline" href={url}>
          {t("reg.editTitle")}
        </a>
      </Shell>
    );
  }

  return (
    <Shell
      title={info.title || t("reg.formTitle")}
      tenantName={info.tenantName}
      logoUrl={info.logoUrl}
      logoHeight={info.logoHeight}
    >
      {info.description ? (
        <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">{info.description}</p>
      ) : null}
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
              setDoneCode(code);
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

export function Shell({
  title,
  tenantName,
  logoUrl,
  logoHeight,
  children,
}: {
  title?: string;
  tenantName?: string;
  logoUrl?: string | null;
  logoHeight?: number;
  children: React.ReactNode;
}) {
  const src = logoUrl || defaultLogo.url;
  const height = logoHeight ? `${logoHeight}px` : "64px";
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-4 py-8">
      <div className="mb-6 flex w-full max-w-xl flex-col items-center text-center">
        <img
          src={src}
          alt=""
          aria-hidden
          className="max-w-full object-contain"
          style={{ height, maxHeight: "120px" }}
        />
        {tenantName ? (
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
            {tenantName}
          </h2>
        ) : null}
      </div>
      <Card className="w-full max-w-xl shadow-lg">
        <CardHeader>
          <CardTitle>{title ?? ""}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
