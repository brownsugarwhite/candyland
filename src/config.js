// Zentrale Tunables von LUDI / swarmOS.
// Architektur-Grundsatz: WELT-GITTER statt Pixel-Framebuffer. Agentenidentität
// = Gitterzellen-Index (stabil über Zoom und Modi), 1 Welteinheit = 1 Zelle.
// Die Kamera skaliert nur die Darstellung — beim Zoomen ordnet sich nie
// etwas neu an. Ein Reserve-Pool liefert Agenten für Text, Bilder und Apps.
export const CONFIG = {
  // Vorschaumodi: wide (Desktop) und high (Mobile).
  // start*: das beim Boot sichtbare Fenster in Gitterzellen (lt. Referenz
  // 01A: 13 Spalten, 01B: 7 Spalten). cols/rows = Gesamtgitter; bei
  // minimalem Zoom füllt es die Fläche exakt (Referenz 02).
  modes: {
    wide: { w: 800, h: 600, cols: 72, rows: 54, startCols: 13, startCol0: 30, startRow0: 22 },
    high: { w: 450, h: 750, cols: 45, rows: 75, startCols: 7, startCol0: 20, startRow0: 32 },
  },

  gitter: {
    agentSize: 1.0,       // Kantenlänge = Lückenbreite (Referenz 01A: eng)
    litParity: 0,         // wach ist die Schachbrett-Hälfte (col+row)%2 === litParity
  },

  pool: { reserve: 260000 }, // Slots für Text/Bilder/Apps (1px-Verdichtung)

  kamera: {
    ease: 10,             // 1/s — kritisch gedämpfte Annäherung an scaleTgt
    wheelFactor: 0.0016,  // Zoomgeschwindigkeit Mausrad
    pinchFactor: 0.011,   // Zoomgeschwindigkeit ctrl+Wheel (Trackpad-Pinch)
  },

  physics: {              // Welteinheiten (Zellen); Feder-Kennwerte sind
    dt: 1 / 120,          // einheitenfrei (1/s²) und bleiben wie erprobt
    maxFrameMs: 50,
    anchorK: 900,
    anchorZeta: 0.9,
    neighborK: 400,
    neighborC: 6,
    dragRate: 2,
    vMax: 40,             // Zellen/s
  },

  cursor: {               // Magnet-Verdrängung — Parameter in SCREEN-px,
    sigma: 90,            // zur Laufzeit durch kamera.scale geteilt, damit
    amp: 26,              // sich der Cursor auf jeder Zoomstufe gleich anfühlt
    shrink: 0.45,
  },

  fieldWarp: {            // Eingabefeld/Karte verbiegen den Raum (Screen-px)
    sigma: 120,
    amp: 22,
    shrink: 0.4,
    insideSpread: 0.55,
    insideBase: 10,
  },

  organic: {
    driftAmp: 0.028,      // Zellen — feines Eigenleben jedes Agenten
    driftHz: 0.13,
    swirlMin: 1.2,        // Zellen/s tangentialer Einflug-Kick
    swirlMax: 3.2,
  },

  wellen: {               // Wasserwellen: wandernde Ringwellen-Zentren
    centers: 3,
    posAmp: 0.045,        // Zellen Auslenkung
    sizeAmp: 0.09,        // Größenmodulation
    k: 1.05,              // Raumfrequenz (rad/Zelle) ≈ Wellenlänge 6 Zellen
    omega: 0.55,          // rad/s — ruhig, organisch
    lambda: 16,           // Abkling-Länge (Zellen)
    wander: 0.05,         // Zellen/s Drift der Zentren
  },

  falloff: {              // radialer Verlauf relativ zur Bildschirmmitte
    bri: 0.42,            // Rand-Helligkeit = 1 - bri·f(d)
    size: 0.26,           // Rand-Größe    = 1 - size·f(d)
  },

  veil: { feather: 90, dim: 0.42 }, // weicher Inhalts-Schleier (Screen-px)

  neural: {               // Verbindungslinien zwischen Träger-Nachbarn
    enabled: true,
    baseAlpha: 0.05,
    gainAlpha: 2.6,       // × Zielabweichung (Welt) beider Enden
    glowAlpha: 0.16,
    maxAlpha: 0.38,
    tint: [0.55, 0.78, 0.9],
  },

  morphWave: { speed: 12 }, // Zellen/s Ausbreitung von Form-Wellen

  feld: {                 // Eingabefeld — Größen in SCREEN-px (zoomstabil)
    widthPx: 310,
    maxWidthPx: 500,
    lineHPx: 30,
    padXPx: 20,
    fontPx: 19,           // Feinraster-Fontgröße (Poppins)
    caretRows: 10,
    caretBlinkHz: 1.1,
    maxBuffer: 2000,
    maxGridAgents: 80,    // so viele Nachbarn morphen maximal zu Buchstaben,
    gridPullDist: 1.5,    // aus diesem Umkreis (Zellen) — Rest: Reserve-Pool
    ringDots: 30,         // feiner Punktring macht das Feld sichtbar
    ringDotPx: 3.4,
  },

  karte: {                // Agentenkarte (Referenz 04) — Größen in SCREEN-px
    tileSizePx: 105,
    nameDxPx: 95, nameDyPx: 38, nameHPx: 24,
    tasksDyPx: 79, tasksHPx: 16,
    buttonDyPx: 145,
    buttonSizePx: 62,
    hoverGrow: 0.35,      // Hover: Agent wächst um 35 %
    hoverEase: 10,
  },

  logo: {                 // LUDi oben mittig (Referenz 08) — Offsets in Zellen
    letterH: 0.52,        // Höhe der Glyph-Agenten L, U (≈ halbe Kachel)
    dxL: -0.62, dxU: 0.12, dxDi: 1.0, // Offsets von der Viewport-Mitte
    briLetter: 0.8,
    briTile: 0.82,
    zoomHide: 0.86,       // < zoomHide·maxScale → LUDI wird wieder Gitter
  },

  claws: {                // Rex-Icon: IMMER oben rechts, IMMER gleich groß
    sizePx: 36,           // Screen-px (zoom-unabhängig)
    dxPx: 42, dyPx: 40,   // Abstand von der oberen rechten Screen-Ecke
    bri: 0.62,
    warpSigmaPx: 58,      // das Gitter weicht dem Icon aus (wie dem Cursor)
    warpAmpPx: 40,
  },

  colors: {
    bgInner: '#3a3e42',   // dunkle Fläche: Mitte …
    bgOuter: '#26292c',   // … Rand (radialer Verlauf)
    agent: [213, 218, 215],   // hellste Agenten-Grundfarbe (Mitte)
    tuerkis: [43, 239, 217],  // Agent-Kacheln / Supervisor
    lila: [179, 102, 232],    // Schnellaktionen
    pink: [241, 79, 200],     // Schließen
    gruen: [22, 199, 132],    // aktiver Modus (Seiten-UI)
    text: [225, 229, 227],    // Feinraster-Schrift im Schwarm
  },

  gradient: 0.05,         // sanfter vertikaler Verlauf im Agenten-Shader

  formen: {               // SDF-Atlas
    tile: 256,            // Kachelgröße px
    grid: 8,              // 8×8 Kacheln → Atlas 2048²
    spread: 28,           // Distanz-Spannweite px (Vorzeichen-Feld)
    span: 0.90,           // Form füllt ±span der Kachel
  },

  breathing: { freqHz: 0.2, base: 0.92, amp: 0.05 },

  boot: { staggerSec: 0.8, spiralSec: 0.25 },

  brain: {                // die Schwarmintelligenz: Anthropic-Modelle
    model: 'claude-sonnet-5',
    maxTokens: 1500,
    timeoutMs: 30000,
    storageKey: 'ludi-api-key', // bleibt lokal im Browser (localStorage)
    maxCommands: 12,
    maxShapeAgents: 3000,
  },

  shapes: { morphRate: 2.2, staggerSec: 0.6 },

  formation: { minAlpha: 24, minLum: 6 }, // Sampling-Schwellen für Text/Bilder

  apps: {                 // App-Übergang: die Content-Region wächst aus der
    inset: 1.0,           // Mitte, das Gitter verdichtet organisch an die
    growSec: 1.0,         // Ränder (kein Sprung, keine Rotation)
    maxOut: 0.6,          // Rand-Kompression: so weit dürfen Agenten raus
    shrink: 0.62,         // Größe der verdichteten Rand-Agenten
    closeSizePx: 32,      // pinker Schließen-Agent (Screen-px)
  },

  spiel2048: {
    pitchDiv: 5.1,        // Brettteilung: minSichtfeld / pitchDiv
    sizeBase: 0.52,       // Blobgröße in Brettteilungen (Stufe 1)
    sizePerLevel: 0.085,
    sizeMax: 0.99,
    mergePause: 0.4,      // s bis der absorbierte Blob im Ziel versinkt
    spawnDelay: 0.18,
    pulse: 0.3,           // elastischer Größen-Puls beim Verschmelzen
    // flat geshadete Stufenfarben (2, 4, 8, …) — Referenz 03
    palette: [
      [53, 240, 160], [43, 232, 184], [35, 217, 219], [41, 185, 240],
      [122, 140, 245], [179, 102, 232], [232, 95, 212], [241, 79, 158],
      [241, 115, 79], [241, 177, 79], [241, 226, 79],
    ],
  },

  wurmloch: {             // Ordner = kreisrundes Loch im Netz (Referenz 06)
    r: 1.05,              // Lochradius (Zellen)
    feather: 2.4,         // Einzugsbereich um den Rand
    rim: 0.5,             // Ring-Kompression: Innen-Agenten stauen sich am Rand
    ringDots: 14,         // kleiner Punktring markiert das Loch
    ringDotPx: 3.4,
    ringSpin: 0.3,        // rad/s — der Ring dreht ruhig
    flugSec: 1.5,         // Kameraflug INS Loch
    flugZoom: 6,          // Zoomfaktor des Flugs
    welleSec: 2.4,        // Aufbau der neuen Dimension als Wasser-Ringwelle
    welleSpeed: 9,        // Zellen/s — Ausbreitung der Aufbau-Welle
    dims: [
      { tint: [213, 218, 215], omega: 0.55 },
      { tint: [228, 213, 194], omega: 0.34 }, // wärmer, noch ruhiger
    ],
  },

  malen: {                // Paint (Referenz 05) — Offsets in Zellen vom Rahmen
    canvas: { dx: 2.3, dy: 2.5, w: 5.6, h: 3.5 }, // weiße Fläche (1px-Agenten)
    picker: { dxRight: 3.1, dy: 0.55, w: 2.4, h: 2.0, hueH: 0.26, px: 4 },
    supervisor: { dx: 1.2, dy: 1.15, size: 0.9 },
    buttons: { dy: 0.95, gap: 2.0, size: 0.9 }, // unter dem Canvas
    brushSizes: [2, 5, 10],  // px auf dem Canvas
    waveSec: 1.1,            // Einflug-Welle des Canvas (Zeilen)
  },
};
