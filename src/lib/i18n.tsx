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
  "home.createBlurb":
    "Generates a random key. Share it with anyone who should administer this org.",
  "home.create": "Create tenant",
  "home.creating": "Creating…",
  "home.keyTitle": "Your tenant key",
  "home.keyBlurb":
    "Save this somewhere safe. Anyone with the key can manage entries and rooms. It will not be shown again.",
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
  "rooms.form.scheme": "Color scheme",
  "rooms.form.schemeHint": "Used for the room name and clock on the display.",
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
  "settings.dangerTitle": "Delete tenant",
  "settings.dangerHint":
    "Deletes this organization with all entries, rooms, colors, ads and the logo. This cannot be undone.",
  "settings.delete": "Delete tenant",
  "settings.deleteConfirm": "Really delete this tenant with all its data? This cannot be undone.",
  "settings.deleted": "Tenant deleted",

  "settings.logo": "Display logo",
  "settings.logoHint": "PNG, JPG or SVG. Shown in the bottom-right of room displays.",
  "settings.logoHeight": "Logo height (px)",
  "settings.logoUpload": "Upload logo",
  "settings.logoDownload": "Download logo",
  "settings.logoRemove": "Remove logo",
  "settings.logoDefault": "Default logo in use",
  "settings.logoSaved": "Logo updated",
  "settings.logoRemoved": "Logo removed",
  "settings.logoTooLarge": "Image is too large (max 2 MB)",

  "admin.tabs.colors": "Colors",

  "colors.title": "Color schemes",
  "colors.new": "New scheme",
  "colors.empty": "No color schemes yet.",
  "colors.default": "Default color",
  "colors.defaultHint": "Used for every entry without its own scheme. Change it in Settings.",
  "colors.deleted": "Scheme deleted",
  "colors.created": "Scheme created",
  "colors.updated": "Scheme updated",
  "colors.confirmDelete":
    "Delete this color scheme? Entries using it fall back to the default color.",
  "colors.form.name": "Name",
  "colors.form.namePh": "Break",
  "colors.form.color": "Base color",
  "colors.swatch.base": "base",
  "colors.swatch.deep": "deep",
  "colors.swatch.peak": "peak",
  "colors.swatch.highlight": "glow",
  "colors.derived": "Derived: glow {glow} · border {border} · pulse {pulse}",
  "settings.accent": "Default color",
  "settings.accentHint":
    "All other shades, lines, fills and animation values are derived from this color.",
  "entries.form.scheme": "Color scheme",
  "entries.form.schemeHint": "Optional. Overrides the default color for this entry only.",
  "entries.form.notify": "Post to webhooks when due",

  "admin.tabs.messages": "Messages",

  "display.empty": "No entries",
  "display.connecting": "Connecting…",
  "display.reconnecting": "Reconnecting…",
  "display.inMinutes": "in {minutes} min",
  "display.now": "NOW",
  "admin.tabs.ads": "Ads",
  "settings.template.ads": "Ads (image slideshow)",
  "settings.adSeconds": "Ad display time (seconds)",
  "settings.adSecondsHint": "Applies to all ads in every room.",
  "rooms.form.template": "Display template",
  "rooms.form.templateGlobal": "Use global setting",
  "rooms.form.templateHint": "Overrides the global template for this room only.",
  "ads.title": "Ads",
  "ads.hint":
    "Upload images (PNG, JPG, SVG, animated GIF or WebP). They rotate in the given order.",
  "ads.upload": "Upload ads",
  "ads.uploaded": "Ads uploaded",
  "ads.empty": "No ads yet.",
  "ads.delete": "Delete",
  "ads.deleted": "Ad deleted",
  "ads.download": "Download",
  "ads.confirmDelete": "Delete this ad?",
  "ads.tooLarge": "Image is too large (max 10 MB)",
  "ads.displayEmpty": "No ads configured",
  "admin.tabs.io": "Import / Export",
  "refId.label": "Id",
  "refId.hint": "Used to reference this object in exports. Leave empty to derive it from the name.",
  "refId.placeholder": "derived from name",
  "io.title": "Import / Export",
  "io.exportTitle": "Export",
  "io.exportHint":
    "ZIP archive with the data as JSON, the JSON schema, a VS Code settings file and all images.",
  "io.export": "Export ZIP",
  "io.importTitle": "Import",
  "io.importHint": "Choose a ZIP export or a JSON file. Only the sections you select are imported.",
  "io.chooseFile": "Choose file",
  "io.noFileSelected": "No file selected",
  "io.mode": "Import mode",
  "io.mode.replace": "Replace",
  "io.mode.append": "Add",
  "io.mode.replaceHint": "Each selected section replaces the existing data completely.",
  "io.mode.appendHint": "Selected data is added; ids are made unique when needed.",
  "io.sections": "Sections",
  "io.noSections": "The file contains no importable sections.",
  "io.start": "Start import",
  "io.importing": "Importing…",
  "io.imported": "Import finished",
  "io.invalid": "File does not match the schema",
  "io.noData": "No data file found in the archive",
  "io.confirmReplace": "Replace mode deletes the existing data of the selected sections. Continue?",
  "io.section.tenant": "Settings",
  "io.section.color_schemes": "Color schemes",
  "io.section.rooms": "Rooms",
  "io.section.entries": "Entries",
  "io.section.ads": "Ads",
  "io.section.logo": "Logo",
  "io.issues": "Issues found",
  "io.noIssues": "No issues found.",
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
  "home.createBlurb":
    "Erzeugt einen zufälligen Schlüssel. Teile ihn mit allen, die diese Organisation verwalten sollen.",
  "home.create": "Mandant anlegen",
  "home.creating": "Wird angelegt…",
  "home.keyTitle": "Dein Mandantenschlüssel",
  "home.keyBlurb":
    "Sicher aufbewahren. Wer den Schlüssel hat, kann Einträge und Räume verwalten. Er wird nicht erneut angezeigt.",
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
  "rooms.form.nameHint":
    "Der Raumname ist gleichzeitig das Tag, mit dem Einträge zugeordnet werden.",
  "rooms.form.scheme": "Farbschema",
  "rooms.form.schemeHint": "Wird für Raumname und Uhrzeit auf der Anzeige verwendet.",
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
  "settings.dangerTitle": "Mandant löschen",
  "settings.dangerHint":
    "Löscht diese Organisation mit allen Einträgen, Räumen, Farben, Anzeigen und dem Logo. Das kann nicht rückgängig gemacht werden.",
  "settings.delete": "Mandant löschen",
  "settings.deleteConfirm":
    "Diesen Mandanten mit allen Daten wirklich löschen? Das kann nicht rückgängig gemacht werden.",
  "settings.deleted": "Mandant gelöscht",

  "settings.logo": "Anzeige-Logo",
  "settings.logoHint": "PNG, JPG oder SVG. Wird unten rechts auf den Raumanzeigen gezeigt.",
  "settings.logoHeight": "Logohöhe (px)",
  "settings.logoUpload": "Logo hochladen",
  "settings.logoDownload": "Logo herunterladen",
  "settings.logoRemove": "Logo entfernen",
  "settings.logoDefault": "Standardlogo aktiv",
  "settings.logoSaved": "Logo aktualisiert",
  "settings.logoRemoved": "Logo entfernt",
  "settings.logoTooLarge": "Bild ist zu groß (max. 2 MB)",

  "admin.tabs.colors": "Farben",

  "colors.title": "Farbschemata",
  "colors.new": "Neues Schema",
  "colors.empty": "Noch keine Farbschemata.",
  "colors.default": "Standardfarbe",
  "colors.defaultHint":
    "Wird für alle Einträge ohne eigenes Schema verwendet. Änderbar in den Einstellungen.",
  "colors.deleted": "Schema gelöscht",
  "colors.created": "Schema angelegt",
  "colors.updated": "Schema aktualisiert",
  "colors.confirmDelete": "Farbschema löschen? Einträge damit nutzen wieder die Standardfarbe.",
  "colors.form.name": "Name",
  "colors.form.namePh": "Pause",
  "colors.form.color": "Grundfarbe",
  "colors.swatch.base": "Basis",
  "colors.swatch.deep": "Dunkel",
  "colors.swatch.peak": "Spitze",
  "colors.swatch.highlight": "Leuchten",
  "colors.derived": "Abgeleitet: Leuchten {glow} · Rahmen {border} · Puls {pulse}",
  "settings.accent": "Standardfarbe",
  "settings.accentHint":
    "Alle weiteren Farbtöne, Linien, Flächen und Animationswerte werden daraus abgeleitet.",
  "entries.form.scheme": "Farbschema",
  "entries.form.schemeHint": "Optional. Überschreibt die Standardfarbe nur für diesen Eintrag.",

  "display.empty": "Keine Einträge",
  "display.connecting": "Verbindung…",
  "display.reconnecting": "Neu verbinden…",
  "display.inMinutes": "in {minutes} min",
  "display.now": "JETZT",
  "admin.tabs.ads": "Anzeigen",
  "settings.template.ads": "Anzeigen (Bild-Slideshow)",
  "settings.adSeconds": "Anzeigedauer je Anzeige (Sekunden)",
  "settings.adSecondsHint": "Gilt global für alle Anzeigen in allen Räumen.",
  "rooms.form.template": "Anzeige-Vorlage",
  "rooms.form.templateGlobal": "Globale Einstellung verwenden",
  "rooms.form.templateHint": "Übersteuert die globale Vorlage nur für diesen Raum.",
  "ads.title": "Anzeigen",
  "ads.hint":
    "Grafiken hochladen (PNG, JPG, SVG, animiertes GIF oder WebP). Sie werden in dieser Reihenfolge gezeigt.",
  "ads.upload": "Anzeigen hochladen",
  "ads.uploaded": "Anzeigen hochgeladen",
  "ads.empty": "Noch keine Anzeigen.",
  "ads.delete": "Löschen",
  "ads.deleted": "Anzeige gelöscht",
  "ads.download": "Herunterladen",
  "ads.confirmDelete": "Diese Anzeige löschen?",
  "ads.tooLarge": "Bild ist zu groß (max. 10 MB)",
  "ads.displayEmpty": "Keine Anzeigen konfiguriert",
  "admin.tabs.io": "Im-/Export",
  "refId.label": "Id",
  "refId.hint":
    "Wird im Export zur Referenzierung genutzt. Leer lassen, um sie aus dem Namen abzuleiten.",
  "refId.placeholder": "aus Namen abgeleitet",
  "io.title": "Import / Export",
  "io.exportTitle": "Export",
  "io.exportHint":
    "ZIP-Archiv mit den Daten als JSON, dem JSON-Schema, einer VS-Code-Einstellungsdatei und allen Grafiken.",
  "io.export": "ZIP exportieren",
  "io.importTitle": "Import",
  "io.importHint":
    "ZIP-Export oder JSON-Datei wählen. Es werden nur die ausgewählten Bereiche importiert.",
  "io.chooseFile": "Datei wählen",
  "io.noFileSelected": "Keine Datei gewählt",
  "io.mode": "Import-Modus",
  "io.mode.replace": "Ersetzen",
  "io.mode.append": "Ergänzen",
  "io.mode.replaceHint": "Jeder gewählte Bereich ersetzt die vorhandenen Daten vollständig.",
  "io.mode.appendHint": "Die Daten werden ergänzt; Ids werden bei Bedarf eindeutig gemacht.",
  "io.sections": "Bereiche",
  "io.noSections": "Die Datei enthält keine importierbaren Bereiche.",
  "io.start": "Import starten",
  "io.importing": "Importiere…",
  "io.imported": "Import abgeschlossen",
  "io.invalid": "Datei entspricht nicht dem Schema",
  "io.noData": "Keine Datendatei im Archiv gefunden",
  "io.confirmReplace":
    "Im Modus Ersetzen werden die vorhandenen Daten der gewählten Bereiche gelöscht. Fortfahren?",
  "io.section.tenant": "Einstellungen",
  "io.section.color_schemes": "Farbschemata",
  "io.section.rooms": "Räume",
  "io.section.entries": "Einträge",
  "io.section.ads": "Anzeigen",
  "io.section.logo": "Logo",
  "io.issues": "Probleme gefunden",
  "io.noIssues": "Keine Probleme gefunden.",
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
