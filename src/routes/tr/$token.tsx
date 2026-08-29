import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import defaultLogo from "@/assets/pit-hackathon-logo.png.asset.json";

export const Route = createFileRoute("/tr/$token")({
  ssr: false,
  component: TrLayout,
  head: () => ({
    meta: [
      { title: "Team registration" },
      { name: "description", content: "Register or edit your hackathon team." },
      { property: "og:title", content: "Team registration" },
      { property: "og:description", content: "Register or edit your hackathon team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function TrLayout() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-4 py-8">
      <div className="w-full max-w-xl">
        <Outlet />
      </div>
    </main>
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
    <>
      <div className="mb-6 flex w-full flex-col items-center text-center">
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
      <Card className="w-full shadow-lg">
        <CardHeader>
          <CardTitle>{title ?? ""}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </>
  );
}
