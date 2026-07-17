# LudiOS / swarmOS — Grundregeln

Diese Regeln sind verbindlich für alles, was in diesem Projekt entsteht.

## Das Schwarm-Prinzip

1. **Alles besteht aus Schwarmagenten.** Jeder Buchstabe, jeder Button, jedes
   Icon, jedes Bild, jedes Spielelement — alles ist ein Agent oder eine
   Formation aus Agenten. Kein DOM-Text und keine DOM-Elemente auf der
   Schwarmfläche; einzige Ausnahme ist das Seiten-UI außerhalb der dunklen
   Fläche (Heading „swarmOS", Toggle wide|high).
2. **Agenten können jede Form annehmen** (SDF-Atlas in `src/formen.js`:
   Squircle, SVG-Pfade, Poppins-Glyphen, Komposit-Kacheln) und stufenlos
   ineinander morphen — alles sind Distanzfelder.
3. **Verdichtung bis 1×1 px.** Agenten skalieren unabhängig und können bis zur
   Mindestdarstellung 1×1 px ohne Abstand verdichten (dann quadratisch,
   lückenlos) → Bilder, Videos, Vektoren und Schriften sind verlustfrei.
   Agenten mit wenigen Aufgaben werden meistens größer dargestellt;
   Verdichtung passiert dort, wo sie gebraucht wird.
4. **Stabile Identität.** Agentenidentität = Gitterzellen-Index im Welt-Gitter
   (1 Welteinheit = 1 Zelle). Zoomen ändert NUR die Kamera (`src/kamera.js`)
   — niemals ordnen sich Agenten beim Zoomen neu an.
5. **Organische Bewegung.** Ruhebewegung folgt mathematischen Wellenmustern
   (Wasser-Ringwellen, `src/wellen.js`); Formationen wirbeln sich per
   Spiral-Einflug zusammen; alles ist smooth, ruhig, ohne harte Kanten
   (weiche Schleier statt Boxen).

## Rex, der Dirigent

- **Rex verwaltet den Schwarm** und ist immer über das Claws-Icon oben rechts
  erreichbar (2 Kratzer = 2 Agenten, `assets/svg/claws.svg`).
- Rex' Intelligenz ist die Claude-API (`src/brain.js`, Key via „key"-Befehl,
  localStorage). Einzelne Agenten haben lokale, simulierte Autonomie und eine
  Identität (deterministischer Name aus der Agenten-Id, z. B. „Agent Vega 4000").
- **Der Cursor-Agent** ist Rex direkt unterstellt und unsichtbar — die
  Cursorbewegung zeigt sich nur als magnetische Verdrängung des Schwarms.

## Design-Sprache

- **Systemschrift: Poppins** (self-hosted, `assets/fonts/`). Auch Schrift
  besteht immer aus Agenten (Feinraster mit Kantenglättung oder Glyph-Kacheln).
- **Farben** (`CONFIG.colors`):
  - Fläche: dunkler radialer Verlauf `#3a3e42` → `#26292c`
  - Agenten: helles Grau `rgb(213,218,215)`, radialer Helligkeits-/Größen-
    Falloff zur Bildschirmmitte (Mitte hell & groß, Rand dunkler & kleiner)
  - Türkis `rgb(43,239,217)`: aktive Agent-Kacheln, Supervisor, Beacons
  - Lila `rgb(179,102,232)`: Schnellaktionen
  - Pink `rgb(241,79,200)`: Schließen-Buttons
  - Grün `rgb(22,199,132)`: aktiver Modus im Seiten-UI
- **Default-Agentenform:** Squircle aus `assets/svg/shape.svg`.
- **Vorschaumodi:** wide 800×600 px (Desktop), high 450×750 px (Mobile).
  Start-Raster exakt wie Referenzen `assets/refs/01A/01B`; Zoombereich vom
  Start-Raster (max) bis zum Feingitter `02_small_grid` (min), supersmooth.
- UI-Texte deutsch, kleinschreibung für Systemmeldungen.

## Interaktion

- Hover: genau EIN Agent nach dem anderen wächst unter dem Cursor; Klick
  öffnet seine Agentenkarte an Ort und Stelle (Referenz `04`): türkise
  Augen-Kachel, Name, Aufgabenliste, lila Schnellaktionen (selbst Agenten).
- Eingabefelder: keine Kästen — Bucht im Schwarm. Umliegende Agenten morphen
  in die Buchstaben (begrenztes Budget, Rest aus dem Reserve-Pool), Text
  bricht automatisch um, das Feld wächst mit; Copy/Paste (⌘V) funktioniert.
- Alles ist eine AUFGABE (Task-Registry im Dirigenten); Gruppen sind wählbar,
  ansprechbar, umbeauftragbar.

## Apps (umgesetzt — Befehle im Eingabefeld)

Gemeinsame Regeln (src/apps/app.js): der Schwarm morpht zum App-Screen —
sichtbare Gitteragenten sammeln sich als unruhiger Rahmen am Rand, das
Logo tritt beiseite, oben rechts sitzt der pinke Schließen-Agent
(Referenz 03). Esc oder pink schließt; danach kehrt alles exakt zurück
(Leak-Regel: poolWach muss wieder auf den Ausgangswert fallen).

- `2048` (`assets/refs/03`, src/apps/spiel2048.js): Kacheln = Schleim-Blobs
  (Phyllotaxis auf Squircle-Kontur), Stufenfarben-Palette, zähe Merges
  (versetzte Ziele), Pfeile/Swipe.
- `malen` (`05`, src/apps/malen.js): weißes 1px-Canvas als Reserve-Block
  (Pixel-Agenten mit 1.55× Überlappung — sonst frisst AA die Deckung!),
  HSV-Picker aus Agenten, Supervisor, Radierer/Pinselgröße, Stift-Cursor
  (OS-Cursor über dem Canvas: none).
- `3d` (`07`, src/apps/editor3d.js + src/mat3d.js + src/mesh3d.js):
  Catmull-Clark-Würfel als geshadete Punktwolke (Agenten = Mesh-Knoten),
  Käfig-Vertices + gepunktete Kanten, Orbit/Dolly, Tab Object/Edit,
  1/2/3 Vertex/Edge/Face, g/r/s/e, Klick bestätigt, Esc bricht ab.
- `vektor` (src/apps/vektor.js + src/fuellung.js): Agenten = Anker und
  Bezier-Handles, 1px-Strich als Agentenkette, Pfad schließen am
  Startpunkt, lila „füllen"-Button → Prompt → Provider-Interface
  (mockProvider sofort; fireflyProvider braucht Token-Proxy — Secret
  gehört nie in den Browser).
- `ordner` (`06A/06B`, in src/dirigent.js): Ordner = kreisrundes Loch im
  Netz (Warp in swarm.postStep, env.holes). Klick hinein: Sog-Spirale
  (suckSec) → Dimensionswechsel mit Kreis-Inversion (Umstülpung, ferne
  Agenten erscheinen innen) → Entfaltung. Dimension 2 ist wärmer getönt
  (store.baseTint) mit langsameren Wellen; Rückweg-Loch am selben Ort.

## Technik

- Vanilla JS, native ES-Module, KEIN Build-Tooling. Start:
  `python3 -m http.server 4173`.
- Renderer-Kaskade WebGPU → WebGL2 → Canvas2D (`?renderer=gl|2d` erzwingt).
  Gemeinsames Instanz-Packing in `src/renderformat.js` — Backends dürfen
  nie auseinanderdriften.
- Physik: CPU, fixe 120-Hz-Substeps; Struct-of-Arrays; schlafende Slots;
  gesettelte Pixel frieren ein (Early-Out).
- Test-API im Browser: `__candy.selftest()`, `__candy.advance(sec)`;
  URL-Hooks `?mode= &advance= &zoom=min|max &klick=x,y &tippe=… &dump &zellen=`.
- Vor Abschluss einer Änderung: Headless-Screenshot gegen die betroffene
  Referenz in `assets/refs/` vergleichen.
