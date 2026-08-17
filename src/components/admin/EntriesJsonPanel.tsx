import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { exportEntriesJson, replaceEntriesJson } from "@/lib/board.functions";
import {
  ENTRIES_SCHEMA_URI,
  entriesJsonSchema,
  entriesJsonSchemaDoc,
  entrySnippetBody,
  localIsoNow,
  type EntryJsonItem,
} from "@/lib/entries-json";

type Loaded = {
  roomIds: string[];
  schemeIds: string[];
  entries: (EntryJsonItem & { id: string })[];
};

const MODEL_URI = "inmemory://model/entries.json";

/** Light theme today; a dark theme only needs a different value here. */
const EDITOR_THEME = "vs";

function stringify(entries: unknown[]) {
  return JSON.stringify({ entries }, null, 2);
}

export function EntriesJsonPanel({
  tenantKey,
  onChange,
}: {
  tenantKey: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const loadFn = useServerFn(exportEntriesJson);
  const saveFn = useServerFn(replaceEntriesJson);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [markers, setMarkers] = useState<{ line: number; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const monacoRef = useRef<Monaco | null>(null);

  const load = async () => {
    try {
      const res = (await loadFn({ data: { key: tenantKey } })) as Loaded;
      setLoaded(res);
      setText(stringify(res.entries));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey]);

  // Register schema + snippet once the editor and the reference lists are known.
  const configure = (monaco: Monaco) => {
    if (!loaded) return;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [
        {
          uri: ENTRIES_SCHEMA_URI,
          fileMatch: [MODEL_URI],
          schema: entriesJsonSchemaDoc(loaded.roomIds, loaded.schemeIds) as object,
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
    const w = window as unknown as { __entrySnippetRegistered?: boolean };
    if (!w.__entrySnippetRegistered) {
      w.__entrySnippetRegistered = true;
      monaco.languages.registerCompletionItemProvider("json", {
        triggerCharacters: ["e", "{"],
        provideCompletionItems: (
          model: import("monaco-editor").editor.ITextModel,
          position: import("monaco-editor").Position,
        ) => {
          const word = model.getWordUntilPosition(position);
          return {
            suggestions: [
              {
                label: "entry",
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: entrySnippetBody(localIsoNow()),
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: "New timeline entry",
                documentation: "Inserts a complete entry skeleton",
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

  // Client-side preview / error list
  const preview = useMemo(() => {
    if (!loaded) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { errors: [(e as Error).message] };
    }
    const res = entriesJsonSchema.safeParse(parsed);
    if (!res.success) {
      return {
        errors: res.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`),
      };
    }
    const errors: string[] = [];
    const byId = new Map(loaded.entries.map((e) => [e.id, e]));
    const keptIds = new Set<string>();
    const items = res.data.entries.map((e, i) => {
      const at = `entries[${i}]`;
      if (Number.isNaN(new Date(e.time).getTime())) errors.push(`${at}.time: invalid date`);
      if (e.end_time && Number.isNaN(new Date(e.end_time).getTime()))
        errors.push(`${at}.end_time: invalid date`);
      for (const r of e.rooms ?? [])
        if (!loaded.roomIds.includes(r)) errors.push(`${at}: unknown room "${r}"`);
      if (e.color_scheme && !loaded.schemeIds.includes(e.color_scheme))
        errors.push(`${at}: unknown color scheme "${e.color_scheme}"`);
      let state: "new" | "changed" | "same" = "new";
      if (e.id) {
        const old = byId.get(e.id);
        if (!old) errors.push(`${at}.id "${e.id}" does not exist`);
        else {
          keptIds.add(e.id);
          const same =
            new Date(old.time).getTime() === new Date(e.time).getTime() &&
            (old.end_time ? new Date(old.end_time).getTime() : null) ===
              (e.end_time ? new Date(e.end_time).getTime() : null) &&
            old.title === e.title &&
            (old.description ?? "") === (e.description ?? "") &&
            JSON.stringify(old.rooms ?? []) === JSON.stringify(e.rooms ?? []) &&
            (old.color_scheme ?? null) === (e.color_scheme ?? null) &&
            old.notify === (e.notify ?? true);
          state = same ? "same" : "changed";
        }
      }
      return { ...e, state };
    });
    const deleted = loaded.entries.filter((e) => !keptIds.has(e.id));
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
        data: { key: tenantKey, entries: preview.items.map(({ state: _s, ...rest }) => rest) },
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
        <p className="text-sm text-muted-foreground">{t("entries.json.hint")}</p>
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
              <h3 className="text-sm font-medium text-destructive">
                {t("entries.json.errors")}
              </h3>
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
                <p className="text-sm text-muted-foreground">{t("entries.empty")}</p>
              ) : null}
              {(preview?.items ?? []).map((e, i) => (
                <div key={i} className="rounded-md border p-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold">
                      {new Date(e.time).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                      {e.end_time
                        ? ` – ${new Date(e.end_time).toLocaleString([], { timeStyle: "short" })}`
                        : ""}
                    </span>
                    {e.state === "new" ? (
                      <Badge>{t("entries.json.new")}</Badge>
                    ) : e.state === "changed" ? (
                      <Badge variant="secondary">{t("entries.json.changed")}</Badge>
                    ) : null}
                    {(e.rooms ?? []).length === 0 ? (
                      <span className="text-xs italic text-muted-foreground">
                        {t("entries.allRooms")}
                      </span>
                    ) : (
                      (e.rooms ?? []).map((r) => (
                        <Badge key={r} variant="outline">
                          {r}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="text-sm font-medium">{e.title}</div>
                  {e.description ? (
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {e.description}
                    </div>
                  ) : null}
                </div>
              ))}
              {(preview?.deleted ?? []).map((e) => (
                <div key={e.id} className="rounded-md border border-destructive/40 p-2 opacity-70">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold line-through">
                      {new Date(e.time).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <Badge variant="destructive">{t("entries.json.deleted")}</Badge>
                  </div>
                  <div className="text-sm font-medium line-through">{e.title}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
