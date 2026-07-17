# LUDI · swarmOS (Prototyp)

Ein experimentelles Betriebssystem, dessen gesamte Oberfläche ein SCHWARM
aus Agenten ist. Kein Fenster, kein Widget, kein Text, der nicht aus
Agenten besteht. Rex, der Dirigent (Claude-API), verwaltet den Schwarm.

Vanilla JS, native ES-Module, null Dependencies, kein Build-Tool.

## Starten

```bash
python3 -m http.server 4173
# → http://localhost:4173
```

Renderer-Kaskade: **WebGPU** → WebGL2 → Canvas2D (`?renderer=gl` bzw.
`?renderer=2d` erzwingt ein Backend).

## Vorschaumodi

Oben auf der Seite: **wide** (800×600, Desktop) | **high** (450×750,
Mobile). Der Toggle baut die Welt für den jeweiligen Modus neu auf.
Die Layouts folgen exakt den Referenzen `assets/refs/01A` und `01B`.

## Bedienung

| Eingabe | Wirkung |
|---|---|
| Maus bewegen | Warp-Verdrängung: der Schwarm weicht magnetisch aus (`p` polt um) |
| Mausrad / Trackpad-/Touch-Pinch | supersmooth zoomen (Startraster ↔ Feingitter, Referenz 02) — Agenten behalten ihre Identität, nichts ordnet sich neu |
| Hover | genau EIN Agent nach dem anderen wächst unter dem Cursor |
| Klick auf Agent | **Agentenkarte** an Ort und Stelle (Referenz 04): türkise Augen-Kachel, Name, Aufgaben, drei lila Schnellaktionen (gruppe wählen · neue aufgabe · auflösen) |
| Klick auf Claws (oben rechts) | Rex direkt beauftragen — Rex ist immer erreichbar |
| Klick ins Leere | Eingabefeld: Bucht im Schwarm, umliegende Agenten morphen in die Buchstaben; wächst mit dem Inhalt, bricht automatisch um, ⌘V funktioniert |
| Enter im Feld | freier Text = Auftrag ans Gehirn (Claude) |
| `2048` im Feld | Schleim-Blob-2048 (Pfeile/Swipe, pinker Close-Agent) |
| `malen` im Feld | Paint: weißes 1px-Canvas, HSV-Picker, Radierer/Pinsel, Stift-Cursor |
| `3d` im Feld | 3D-Editor: Orbit (Drag), Dolly (Rad), Tab Edit-Mode, 1/2/3 Vertex/Edge/Face, g/r/s/e |
| `vektor` im Feld | Stift wie Illustrator: Klick Ecke, Klick+Ziehen Kurve (Agenten = Bezier-Handles), Startpunkt schließt, lila Button füllt generativ (Mock/Firefly) |
| `ordner` im Feld | Wurmloch-Ordner: kreisrundes Loch im Netz — Klick hinein reist in die nächste Dimension (Rückweg-Loch inklusive) |
| `key` im Feld | API-Key setzen (maskiert, localStorage) · „weg" löscht |
| Enter (bei offener Karte) | Aufgabe zuteilen — Builtins sofort (Farbwörter, „leuchtfeuer", „auflösen"), Rest plant das Gehirn |
| `1` `2` `3` | Form-Welle vom Cursor: Squircle / Kreis / Quadrat |
| `h` | Dev-HUD (fps, Renderer, Zoom, Hover-Id) |
| Esc / Klick außerhalb | Feld/Karte/Formation auflösen |

**Alles ist eine Aufgabe:** jede Formation registriert sich als benannter
Task (logo: LUDi, rex: dirigent, eingabe-text, KI: …); jeder Agent kennt
seine Aufgabe und Gruppen sind als Ganzes wähl-, färb- und umbeauftragbar.

## Architektur

Siehe [docs/architektur.md](docs/architektur.md) und die Grundregeln in
[CLAUDE.md](CLAUDE.md). Kurzfassung: **Welt-Gitter** statt Pixel-Framebuffer
— Agentenidentität = Gitterzellen-Index (stabil über Zoom und Modi), Kamera
skaliert nur die Darstellung, SDF-Formen-Atlas (Squircle/Claws/Glyphen)
macht jede Form morphbar, Reserve-Pool (~260k) verdichtet für Text/Bilder
bis 1×1 px verlustfrei.

## Das Gehirn (Anthropic)

Der Dirigent Rex ist an die Anthropic-API angebunden (`src/brain.js`):

1. **Aktivieren:** `key` ins Eingabefeld tippen → API-Key einfügen
   (console.anthropic.com). Der Key bleibt **lokal in localStorage** und geht
   ausschließlich an api.anthropic.com (Modell: `claude-sonnet-5`).
2. **Fragen/Bauen:** freien Text ins Eingabefeld + Enter — oder über die
   Agentenkarte einer Gruppe eine Aufgabe geben.
3. Das Modell antwortet mit einem **Formations-Plan** (JSON: heading, text,
   panel, mathematische shapes, color, morph) — LUDI validiert, klemmt
   Grenzen fest und führt aus.

## Apps (alle aus Schwarmagenten, Referenzen in assets/refs/)

1. **2048** (`03`): Kacheln = Schleim-Blobs (Phyllotaxis-Cluster, zähe
   Merges), Stufen unterscheiden sich in Farbe & Größe, Rahmen aus
   unruhigen Kleinst-Agenten, pinker Close-Agent
2. **Paint** (`05`): weißes 1px-Canvas (Reserve-Block, verlustfrei),
   HSV-Picker aus Agenten, Supervisor-Agent, Radierer/Pinselgröße,
   Cursoragent wird über dem Canvas zum Stift
3. **3D-Editor** (`07`): Bodengrid + Catmull-Clark-Würfel als geshadete
   Punktwolke, Käfig aus Vertex-Agenten; Orbit/Dolly, Object/Edit-Mode,
   Vertex/Edge/Face-Select, Grab/Rotate/Scale/Extrude
4. **Vektor** (`src/fuellung.js`): Agenten = Anker & Bezier-Handles,
   1px-Pfadstrich, generative Füllung über Provider-Interface —
   Mock sofort, Adobe Firefly Fill Image API sobald Token-Proxy da ist
5. **Wurmloch-Ordner** (`06`): Ordner = kreisrundes Loch im Netz;
   Klick hinein → Sog + Umstülpung (Kreis-Inversion) in die zweite,
   wärmere Dimension mit Rückweg-Loch

## Debug & Tests

`window.__candy`: `selftest()`, `advance(sec)`, Store, Dirigent, Kamera.
URL-Hooks für Headless-Screenshots:
`?mode= &advance=6 &zoom=min|max &klick=x,y &tippe=… &dump &zellen=c,r;…`
