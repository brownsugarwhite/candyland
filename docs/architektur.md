# Architektur

> **LUDI v0.3 — Welt-Gitter-Architektur (swarmOS):** Agentenidentität =
> Gitterzellen-Index in einem Welt-Gitter (1 Welteinheit = 1 Zelle; wide
> 72×54, high 45×75). Die Kamera `{cx, cy, scale}` skaliert nur die
> Darstellung (Transformation im Vertex-Shader) — **Zoomen ordnet nie etwas
> neu an**. Wach ist default die Schachbrett-Hälfte des Gitters (~1.900
> Squircle-Kacheln); die dunklen Lücken-Zellen sind schlafende adressierbare
> Agenten (Logo, Claws, Schnellaktionen), dahinter liegt ein Reserve-Pool
> (~260.000) für Feinraster-Text, Bilder und Apps — Verdichtung bis 1×1 px,
> verlustfrei, gesettelte Pixel frieren ein (Early-Out).

## Konzept → Modul

| Konzept | Modul | Kern |
|---|---|---|
| Welt-Gitter | `src/gitter.js` | Zellindex = Identität; Schachbrett-Parität wach; `nearestLit`/`nearestGap`; Reserve-Slots dahinter |
| Kamera & Zoom | `src/kamera.js` | scaleTgt kritisch gedämpft, am Cursor verankert, Clamping auf Gitterränder; Zoombereich Startraster (01A) ↔ Feingitter (02) |
| Schwarm-Kern | `src/swarm.js` | Struct-of-Arrays, activeList, Feder-Physik (120-Hz-Substeps), Warp-Pass, radialer Falloff, Freeze, Reserve-Freelist |
| Wellen | `src/wellen.js` | Wasser-Ringwellen wandernder Zentren: `sin(k·r−ωt)·exp(−r/λ)` moduliert Position + Größe |
| Formen | `src/formen.js` | SDF-Atlas zur Laufzeit (Felzenszwalb-EDT): Squircle (shape.svg), 2 Claw-Kratzer, Poppins-Glyphen, DI-/Augen-Kachel; alles morphbar (Distanzfeld-Mix) |
| Renderer | `src/rendererGPU.js` / `rendererGL.js` / `renderer2d.js` | Instanzierte Quads; WGSL-Vertex-Pulling aus Storage-Buffer bzw. GL-Instanz-Attribute; gemeinsames Packing in `src/renderformat.js` (12 f32/Agent) |
| Dirigent | `src/dirigent.js` | Aufgaben-Registry, Agenten-Identität (deterministische Namen), Feinraster-Text aus Reserve, Notizen, Brain-Glue, Event-Routing |
| Eingabefeld | `src/feld.js` | Bucht im Schwarm: Warp + Diff-Retype, Wortumbruch, Auto-Grow, ⌘V; Nachbar-Agenten morphen in Buchstaben (Budget), Rest Reserve |
| Hover/Auswahl | `src/auswahl.js` | genau ein Agent wächst unterm Cursor (geeast); Logo/Claws inklusive |
| Agentenkarte | `src/agentenkarte.js` | Referenz 04: Augen-Kachel türkis, Name/Aufgaben als Feinraster, 3 lila Schnellaktionen in Gitterlücken |
| Logo & Claws | `src/logo.js` | L/U = Lücken-Agenten mit Glyph-Kacheln, DI = Gitter-Kachel mit Stanzung, Claws = 2 Kratzer-Agenten (Referenzen 08/09) |
| Rekrutierung | `src/assign.js` | Spatial-Hash + Greedy in Weltkoordinaten |
| Gehirn | `src/brain.js` | Anthropic-API; Plan-Validierung; Sichtfeld-Größe im Systemprompt |
| Feinschrift | `src/rasterize.js`, `src/textpanel.js` | Poppins proportional, Alpha pro Zelle (Kantenglättung), Wortumbruch |
| Boot/Shell | `src/main.js`, `index.html` | async Boot (Fonts → Atlas → Renderer-Kaskade), wide|high-Toggle, HUD, Test-Hooks |

## Physik („starr magnetisch", Welteinheiten)

- Semi-implizites Euler, fixes `dt = 1/120 s` im rAF-Akkumulator (Clamp 50 ms)
- Anker-Feder Richtung `target`: `kA = 900`, ζ = 0.9 (magnetischer Snap)
- Nachbar-Federn (4 Diagonalen, Restlänge √2 Zellen): `kN = 400`
- `vMax = 40 Zellen/s`; Spiral-Einflug (tangentialer Kick) bei jedem Wecken

## Warp & Falloff

`target = home + Wellen + Drift + Cursor-Warp + Rect-Warps` (postStep).
Cursor- und Feld-Warp sind in **Screen-px** definiert und werden durch
`kamera.scale` geteilt → fühlen sich auf jeder Zoomstufe gleich an.
Radialer Helligkeits-/Größen-Falloff wird pro Frame im **Screen-Space**
relativ zur Viewport-Mitte berechnet (Referenz-Look: Mitte hell & groß).

## Renderer

Beide GPU-Backends teilen sich `renderformat.js` (Packing + Culling) und
denselben Distanzfeld-Shader: analytische SDFs (Kreis/Quadrat/Dreieck, Id
< 8) und Atlas-Kacheln (Id ≥ 8, 256-px-Kacheln, spread 28 px, R8) werden
gemischt → Morph zwischen beliebigen Formen. Hintergrund = radialer
Verlauf als Fullscreen-Pass. Atlas-Uploads folgen einem Versionszähler
(Glyphen können zur Laufzeit dazukommen); WebGPU bekommt eine manuell
erzeugte Mip-Kette, WebGL2 nutzt `generateMipmap`.

## Aufgaben & Identität

Jede Formation registriert sich als benannter Task (Registry im
Dirigenten); jeder Agent trägt `taskId`. Agenten-Namen entstehen
deterministisch aus der Id („Agent Vega 4000") — die Identität ist stabil,
weil die Id es ist. Die Agentenkarte zeigt Name + bis zu 3 Aufgabenzeilen;
Schnellaktionen: gruppe wählen (Glüh-Puls), neue aufgabe (Feld →
`assignTask`: Builtins sofort, Rest ans Gehirn), auflösen.

## Headless-Tests

`__candy.selftest()` (Invarianten), `__candy.advance(sec)` (deterministisch,
rAF-unabhängig). URL-Hooks: `?mode= &advance= &zoom=min|max &klick=x,y
&tippe=… &dump &zellen=c,r;…` — Basis für Screenshot-Vergleiche gegen
`assets/refs/` mit Headless-Chrome (`--virtual-time-budget`).

## Bewusste Zukunfts-Haken

- **Reserve-Blöcke**: zusammenhängende 1px-Blöcke (Bilder/Video/Paint) über
  die Freelist; Identitäts-Mapping im Block wie in v0.2.
- **App-Framework** (Phase 2): `{ mount(dirigent, region), update, unmount }`
  mit pinkem Close-Agent — 2048, Paint, 3D, Vektor, Wurmloch.
- **Linien-Pass**: im GL-Renderer entfernt, kehrt für 3D-Drahtgitter zurück.
- **Worker-/GPU-Physik**: erst wenn Profiling es erzwingt; Storage-Buffer-
  Layout ist die Vorbereitung.
