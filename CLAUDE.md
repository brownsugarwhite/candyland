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
- **Klick auf die Claws** (Referenz `12_rex_demo_final`): Rex morpht
  aus den VERBINDUNGSLINIEN des Schwarms (`src/rex3d.js`, Modell
  `assets/obj/rex.obj`). Die Linien sind ECHTE Linien — der
  Kapsel-Pass der Renderer (`store.kapseln`, instanzierte Quads mit
  Kapsel-SDF, Dicke in px) — KEINE Agenten; Agenten sitzen nur an den
  Knotenpunkten der Platte. Intro: (1) betroffene Gitteragenten
  skalieren nach Nähe (außen ~0.5 der Kachel, innen → 0), (2) Linien
  im Kopfbereich verdicken sich mit Transition auf ~3px, (3) aus den
  geraden Gitterlinien formen sich smooth die gekrümmten Kurven
  (Morph gerade → subdividierte Kurve, gestaffelt von außen nach
  innen), während Kopf und Arme sich von hinten durchs Gitter pressen
  (z-Hub). Rand-Speichen docken an echte volle Gitterkacheln an.
  Screen-fest (~270px) rechts unter der Mitte; Kopf folgt dem Cursor;
  Esc/Claws schließt. Die Subdivision ist als GEWICHTSMATRIX abgelegt
  (geo.gewichte, Catmull-Clark ist linear): spätere Blender-Posen
  (glTF Shape Keys / OBJ-Sequenz gleicher Topologie) müssen nur die
  Käfig-Vertices liefern — applyPose() erzeugt die glatten Kurven,
  Linien und Knoten folgen automatisch.
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
- `tunnel`/`ordner` (Referenz `10_ordner_shader_wurmloch`,
  src/dirigent.js): Schwarzes Loch mit ECHTER Gravitationslinse.
  Zwei Schichten: (1) renderformat.lochWarp (Weltebene) hält die
  Quellfläche innerhalb schluck·θE immer komplett leer und verdichtet
  die Umgebung sanft; (2) der Post-Shader wendet die Punktmassen-
  Linsengleichung β = θ − θE²/θ PRO PIXEL an — die Kacheln krümmen
  sich zu echten Bögen um den Ring, mit leichter chromatischer
  Aberration und feiner Mint-Ringlinie. β wird nie < 0.8·θE gesampelt
  (leerer Gap, keine Zweitbilder) und es wird ausschließlich die echte
  Szene gesampelt — Bandtönung ist unmöglich. Label/Marker leben im
  unverzerrten Inneren (< 0.8·θE). Alles blendet weich ein (h.st).
  Drag verschiebt das Loch. Klick = die REISE: die Kamera fliegt
  smooth hinein (θE wächst über den Schirm, die Linse zieht die
  Agenten lang, sie bleiben immer am Rand), im Inneren dreht die WELT
  echt 180° um die vertikale Wurmloch-Achse (project3d.yaw), Ankunft
  auf der Gegenseite: die Agenten morphen aus dem Lochrand zurück,
  der Schwarm justiert sich mit einer schnellen Welle (welleKick).

## Technik

- Vanilla JS, native ES-Module, KEIN Build-Tooling. Start:
  `python3 -m http.server 4173`.
- Renderer-Kaskade WebGPU → WebGL2 → Canvas2D (`?renderer=gl|2d` erzwingt).
  Gemeinsames Instanz-Packing in `src/renderformat.js` — Backends dürfen
  nie auseinanderdriften.
- **Echtes 3D — immer.** Jeder Agent hat eine echte 3D-Position
  (`store.zPos`, < 0 = über der Fläche) und eine anisotrope Streckung
  entlang seiner rot-Achse (`store.aspekt`, Instanz-Attribut in beiden
  GPU-Shadern). Alles läuft IMMER durch die echte Lochkamera
  (`renderformat.project3d`, Zustand `store.p3d`): Perspektive,
  Tiefennebel zur Hintergrundfarbe, Maler-Sortierung, Near-Plane.
  Größen skalieren mit der Kameranähe (Liniendicke wächst zur Kamera).
- **Kameramodi** (Befehle im Eingabefeld, weich überblendet): Default =
  GELOCKTE perspektivische Draufsicht — für flache Punkte mathematisch
  exakt die direkte Abbildung, der Grundlook ändert sich nie. `2d` =
  echte Orthografie, `iso` = isometrisch, `frei` = geneigte Perspektive;
  derselbe Befehl sperrt zurück. Apps erzwingen die Draufsicht.
- Physik: CPU, fixe 120-Hz-Substeps; Struct-of-Arrays; schlafende Slots;
  gesettelte Pixel frieren ein (Early-Out).
- Test-API im Browser: `__candy.selftest()`, `__candy.advance(sec)`;
  URL-Hooks `?mode= &advance= &zoom=min|max &klick=x,y &tippe=… &dump &zellen=`.
- Vor Abschluss einer Änderung: Headless-Screenshot gegen die betroffene
  Referenz in `assets/refs/` vergleichen.
