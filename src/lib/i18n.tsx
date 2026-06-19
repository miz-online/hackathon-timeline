import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Lang = "en" | "de";

type Dict = Record<string, string>;

const en: Dict = {
  "app.title": "Room Board",
  "app.tagline": "Live time-based entries on display screens, no accounts needed.",
  "nav.admin": "Admin",
  "nav.rooms": "Rooms",
  "nav.exit": "Exit",
  "nav.back": "Back",
  "nav.home": "Home",
  "lang.label": "Language",

  "home.openTitle": "Open existing tenant",
  "home.openPlaceholder": "Enter your tenant key",
  "home.open": "Open",
  "home.createTitle": "Create new tenant",
  "home.createBlurb": "Generates a random key. Share it with anyone who should administer this org.",
  "home.create": "Create tenant",
  "home.creating": "Creating…",
  "home.keyTitle": "Your tenant key",
  "home.keyBlurb": "Save this somewhere safe. Anyone with the key can manage entries and rooms. It will not be shown again.",
  "home.copy": "Copy",
  "home.continue": "Continue",

  "tenant.gate.title": "Enter tenant key",
  "tenant.gate.placeholder": "Tenant key",

  "admin.label": "Admin",
  "admin.tabs.entries": "Entries",
  "admin.tabs.rooms": "Rooms",
  "admin.tabs.settings": "Settings",
  "admin.unknown": "Unknown tenant key",
  "admin.unknownBlurb": "The key in the URL doesn't match any tenant.",
  "admin.backStart": "Back to start",
  "admin.loading": "Loading…",

  "entries.title": "Time entries",
  "entries.new": "New entry",
  "entries.empty": "No entries yet.",
  "entries.edit": "Edit",
  "entries.delete": "Delete",
  "entries.confirmDelete": "Delete this entry?",
  "entries.deleted": "Entry deleted",
  "entries.created": "Entry created",
  "entries.updated": "Entry updated",
  "entries.form.time": "Time",
  "entries.form.title": "Title",
  "entries.form.titlePh": "Begrüßung der Teilnehmer:innen",
  "entries.form.description": "Description (optional)",
  "entries.form.descriptionPh": "Vorstellung des Ablaufs…",
  "entries.form.rooms": "Rooms",
  "entries.form.roomsHint": "Select one or more rooms. Leave empty to show in all rooms.",
  "entries.allRooms": "all rooms",
  "entries.cancel": "Cancel",
  "entries.save": "Save",
  "entries.saving": "Saving…",

  "rooms.title": "Rooms",
  "rooms.new": "New room",
  "rooms.empty": "No rooms yet.",
  "rooms.openDisplay": "Open display",
  "rooms.edit": "Edit",
  "rooms.delete": "Delete",
  "rooms.confirmDelete": "Delete this room?",
  "rooms.deleted": "Room deleted",
  "rooms.created": "Room created",
  "rooms.updated": "Room updated",
  "rooms.form.name": "Name",
  "rooms.form.namePh": "Main Stage",
  "rooms.form.nameHint": "The room name is also the tag used to address entries.",
  "rooms.picker.empty": "No rooms yet. Add some in the admin.",

  "settings.title": "Settings",
  "settings.name": "Organization name",
  "settings.grace": "Hide entries this many minutes after they pass",
  "settings.template": "Display template",
  "settings.template.zeitplan": "Zeitplan (time-sorted list)",
  "settings.language": "Default language",
  "settings.save": "Save settings",
  "settings.saved": "Settings saved",
  "settings.keyTitle": "Tenant key",
  "settings.regenerate": "Regenerate key",
  "settings.regenerateConfirm": "Generate a new key? The old key stops working immediately.",
  "settings.regenerated": "New tenant key generated",

  "display.empty": "No entries",
  "display.connecting": "Connecting…",
  "display.reconnecting": "Reconnecting…",
  "display.inMinutes": "in {minutes} min",
  "display.now": "NOW",
};

const de: Dict = {
  "app.title": "Raum-Anzeige",
  "app.tagline": "Live zeitbasierte Einträge auf Anzeige-Bildschirmen, ohne Konten.",
  "nav.admin": "Verwaltung",
  "nav.rooms": "Räume",
  "nav.exit": "Beenden",
  "nav.back": "Zurück",
  "nav.home": "Start",
  "lang.label": "Sprache",

  "home.openTitle": "Bestehenden Mandanten öffnen",
  "home.openPlaceholder": "Mandantenschlüssel eingeben",
  "home.open": "Öffnen",
  "home.createTitle": "Neuen Mandanten anlegen",
  "home.createBlurb": "Erzeugt einen zufälligen Schlüssel. Teile ihn mit allen, die diese Organisation verwalten sollen.",
  "home.create": "Mandant anlegen",
  "home.creating": "Wird angelegt…",
  "home.keyTitle": "Dein Mandantenschlüssel",
  "home.keyBlurb": "Sicher aufbewahren. Wer den Schlüssel hat, kann Einträge und Räume verwalten. Er wird nicht erneut angezeigt.",
  "home.copy": "Kopieren",
  "home.continue": "Weiter",

  "tenant.gate.title": "Mandantenschlüssel eingeben",
  "tenant.gate.placeholder": "Mandantenschlüssel",

  "admin.label": "Verwaltung",
  "admin.tabs.entries": "Einträge",
  "admin.tabs.rooms": "Räume",
  "admin.tabs.settings": "Einstellungen",
  "admin.unknown": "Unbekannter Mandantenschlüssel",
  "admin.unknownBlurb": "Der Schlüssel in der URL passt zu keinem Mandanten.",
  "admin.backStart": "Zum Start",
  "admin.loading": "Lädt…",

  "entries.title": "Zeit-Einträge",
  "entries.new": "Neuer Eintrag",
  "entries.empty": "Noch keine Einträge.",
  "entries.edit": "Bearbeiten",
  "entries.delete": "Löschen",
  "entries.confirmDelete": "Eintrag löschen?",
  "entries.deleted": "Eintrag gelöscht",
  "entries.created": "Eintrag angelegt",
  "entries.updated": "Eintrag aktualisiert",
  "entries.form.time": "Zeit",
  "entries.form.title": "Titel",
  "entries.form.titlePh": "Begrüßung der Teilnehmer:innen",
  "entries.form.description": "Beschreibung (optional)",
  "entries.form.descriptionPh": "Vorstellung des Ablaufs…",
  "entries.form.rooms": "Räume",
  "entries.form.roomsHint": "Einen oder mehrere Räume wählen. Leer = in allen Räumen anzeigen.",
  "entries.allRooms": "alle Räume",
  "entries.cancel": "Abbrechen",
  "entries.save": "Speichern",
  "entries.saving": "Speichert…",

  "rooms.title": "Räume",
  "rooms.new": "Neuer Raum",
  "rooms.empty": "Noch keine Räume.",
  "rooms.openDisplay": "Anzeige öffnen",
  "rooms.edit": "Bearbeiten",
  "rooms.delete": "Löschen",
  "rooms.confirmDelete": "Raum löschen?",
  "rooms.deleted": "Raum gelöscht",
  "rooms.created": "Raum angelegt",
  "rooms.updated": "Raum aktualisiert",
  "rooms.form.name": "Name",
  "rooms.form.namePh": "Hauptbühne",
  "rooms.form.nameHint": "Der Raumname ist gleichzeitig das Tag, mit dem Einträge zugeordnet werden.",
  "rooms.picker.empty": "Noch keine Räume. In der Verwaltung anlegen.",

  "settings.title": "Einstellungen",
  "settings.name": "Name der Organisation",
  "settings.grace": "Einträge so viele Minuten nach Ablauf ausblenden",
  "settings.template": "Anzeige-Vorlage",
  "settings.template.zeitplan": "Zeitplan (zeitsortierte Liste)",
  "settings.language": "Standardsprache",
  "settings.save": "Einstellungen speichern",
  "settings.saved": "Einstellungen gespeichert",
  "settings.keyTitle": "Mandantenschlüssel",
  "settings.regenerate": "Schlüssel neu erzeugen",
  "settings.regenerateConfirm": "Neuen Schlüssel erzeugen? Der alte Schlüssel funktioniert sofort nicht mehr.",
  "settings.regenerated": "Neuer Mandantenschlüssel erzeugt",

  "display.empty": "Keine Einträge",
  "display.connecting": "Verbindung…",
  "display.reconnecting": "Neu verbinden…",
  "display.inMinutes": "in {minutes} min",
};

const DICTS: Record<Lang, Dict> = { en, de };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};
const I18nContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "rb.lang";

function detectInitial(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "de") return saved;
  const nav = window.navigator?.language?.toLowerCase() ?? "";
  return nav.startsWith("de") ? "de" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    setLangState(detectInitial());
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  };
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: string, params?: Record<string, string | number>) => {
    let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  };
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside provider");
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={className ?? "flex items-center gap-2 text-xs text-muted-foreground"}>
      <span className="sr-only">{t("lang.label")}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="rounded border bg-background px-2 py-1 text-xs"
      >
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </label>
  );
}
