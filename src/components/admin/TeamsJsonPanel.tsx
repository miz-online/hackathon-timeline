import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { exportTeamsJson, replaceTeamsJson } from "@/lib/board.functions";
import {
  TEAMS_SCHEMA_URI,
  teamsJsonSchema,
  teamsJsonSchemaDoc,
  teamSnippetBody,
  type TeamJsonItem,
} from "@/lib/teams-json";

type Loaded = {
  roomIds: string[];
  teams: (TeamJsonItem & { id: string })[];
};

const MODEL_URI = "inmemory://model/teams.json";
const EDITOR_THEME = "vs";

function stringify(teams: unknown[]) {
  return JSON.stringify({ teams }, null, 2);
}

export function TeamsJsonPanel({
  tenantKey,
  onChange,
}: {
  tenantKey: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const loadFn = useServerFn(exportTeamsJson);
  const saveFn = useServerFn(replaceTeamsJson);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [markers, setMarkers] = useState<{ line: number; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const monacoRef = useRef<Monaco | null>(null);

  const load = async () => {
    try {
      const res = (await loadFn({ data: { key: tenantKey } })) as Loaded;
      setLoaded(res);
      setText(stringify(res.teams));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey]);

  const configure = (monaco: Monaco) => {
    if (!loaded) return;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [
        {
          uri: TEAMS_SCHEMA_URI,
          fileMatch: [MODEL_URI],
          schema: teamsJsonSchemaDoc(loaded.roomIds) as object,
        },
      ],
    });
  };

  useEffect(() => {
    if (monacoRef.current) configure(monacoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const onMount: OnMount = (_editor, monaco) => {
    monacoRef.current = monaco;
    configure(monaco);
    const w = window as unknown as { __teamSnippetRegistered?: boolean };
    if (!w.__teamSnippetRegistered) {
      w.__teamSnippetRegistered = true;
      monaco.languages.registerCompletionItemProvider("json", {
        triggerCharacters: ["t", "{"],
        provideCompletionItems: (
          model: import("monaco-editor").editor.ITextModel,
          position: import("monaco-editor").Position,
        ) => {
          const word = model.getWordUntilPosition(position);
          return {
            suggestions: [
              {
                label: "team",
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: teamSnippetBody(),
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: "New team",
                documentation: "Inserts a complete team skeleton",
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn,
                },
              },
            ],
          };
        },
      });
    }
  };

  const preview = useMemo(() => {
    if (!loaded) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { errors: [(e as Error).message] };
    }
    const res = teamsJsonSchema.safeParse(parsed);
    if (!res.success) {
      return {
        errors: res.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`),
      };
    }
    const errors: string[] = [];
    const byId = new Map(loaded.teams.map((tm) => [tm.id, tm]));
    const keptIds = new Set<string>();
    const items = res.data.teams.map((tm, i) => {
      const at = `teams[${i}]`;
      if (tm.room && !loaded.roomIds.includes(tm.room))
        errors.push(`${at}: unknown room "${tm.room}"`);
      let state: "new" | "changed" | "same" = "new";
      if (tm.id) {
        const old = byId.get(tm.id);
        if (!old) errors.push(`${at}.id "${tm.id}" does not exist`);
        else {
          keptIds.add(tm.id);
          const same =
            old.name === tm.name &&
            (old.ref_id ?? null) === (tm.ref_id ?? null) &&
            (old.members ?? "") === (tm.members ?? "") &&
            (old.project ?? "") === (tm.project ?? "") &&
            (old.room ?? null) === (tm.room ?? null) &&
            loaded.teams.findIndex((x) => x.id === tm.id) === i;
          state = same ? "same" : "changed";
        }
      }
      return { ...tm, state };
    });
    const deleted = loaded.teams.filter((tm) => !keptIds.has(tm.id));
    return { errors, items, deleted };
  }, [text, loaded]);

  const jsonErrors = [
    ...(preview?.errors ?? []),
    ...markers.map((m) => `${t("entries.json.line")} ${m.line}: ${m.message}`),
  ];
  const hasErrors = jsonErrors.length > 0;

  const save = async () => {
    if (!preview || hasErrors || !preview.items) return;
    setSaving(true);
    try {
      const res = (await saveFn({
        data: { key: tenantKey, teams: preview.items.map(({ state: _s, ...rest }) => rest) },
      })) as { updated: number; created: number; deleted: number };
      toast.success(
        t("entries.json.saved", {
          updated: res.updated,
          created: res.created,
          deleted: res.deleted,
        }),
      );
      await load();
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("teams.json.hint")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={saving}>
            {t("entries.json.reload")}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || hasErrors}>
            {saving ? t("entries.saving") : t("entries.json.apply")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <Editor
            height="70vh"
            language="json"
            theme={EDITOR_THEME}
            path={MODEL_URI}
            value={text}
            onChange={(v) => setText(v ?? "")}
            onMount={onMount}
            onValidate={(ms) =>
              setMarkers(
                ms
                  .filter((m) => m.severity >= 8)
                  .map((m) => ({ line: m.startLineNumber, message: m.message })),
              )
            }
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
            }}
          />
        </Card>

        <Card className="max-h-[70vh] overflow-auto p-3">
          {hasErrors ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-destructive">{t("entries.json.errors")}</h3>
              <ul className="space-y-1 text-sm text-destructive">
                {jsonErrors.map((e, i) => (
                  <li key={i} className="font-mono break-words">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("entries.json.preview")}</h3>
              {(preview?.items ?? []).length === 0 && (preview?.deleted ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("teams.empty")}</p>
              ) : null}
              {(preview?.items ?? []).map((tm, i) => (
                <div key={i} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{i + 1}</span>
                    <span className="text-sm font-medium">{tm.name}</span>
                    {tm.state === "new" ? (
                      <Badge>{t("entries.json.new")}</Badge>
                    ) : tm.state === "changed" ? (
                      <Badge variant="secondary">{t("entries.json.changed")}</Badge>
                    ) : null}
                    {tm.room ? (
                      <Badge variant="outline">{tm.room}</Badge>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        {t("teams.noRoom")}
                      </span>
                    )}
                  </div>
                  {tm.members ? (
                    <div className="text-sm text-muted-foreground break-words">{tm.members}</div>
                  ) : null}
                  {tm.project ? (
                    <div className="whitespace-pre-wrap break-words text-sm">{tm.project}</div>
                  ) : null}
                </div>
              ))}
              {(preview?.deleted ?? []).map((tm) => (
                <div key={tm.id} className="rounded-md border border-destructive/40 p-2 opacity-70">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium line-through">{tm.name}</span>
                    <Badge variant="destructive">{t("entries.json.deleted")}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
