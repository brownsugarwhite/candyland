// Zentrale Tunables von LUDI / swarmOS.
// Architektur-Grundsatz: WELT-GITTER statt Pixel-Framebuffer. Agentenidentität
// = Gitterzellen-Index (stabil über Zoom und Modi), 1 Welteinheit = 1 Zelle.
// Die Kamera skaliert nur die Darstellung — beim Zoomen ordnet sich nie
// etwas neu an. Ein Reserve-Pool liefert Agenten für Text, Bilder und Apps.
export const CONFIG = {
  // Vorschaumodi: wide (Desktop, per Drag skalierbar) und high (Mobile).
  // Das LANDING-Raster passt sich dem Screen an: Zellgröße ≈ zellePx,
  // GERADE Spaltenzahl → Kachel oben links, FREIE Zelle oben rechts
  // (dort wohnt das Rex-Icon). Referenzen 01A (16×12 @ 50 px) und 01B.
  modes: {
    wide: { w: 800, h: 600, resizable: true },
    high: { w: 450, h: 750, resizable: false },
  },

  gitter: {
    zellePx: 50,          // Ziel-Zellgröße beim Landing (Referenz: 800/16)
    agentSize: 1.0,       // Kachelgröße = Abstand (Kachel füllt die Zelle)
    litParity: 0,         // wach ist die Schachbrett-Hälfte (col+row)%2 === litParity
    latFaktor: 4,         // Gesamtgitter = latFaktor × Landing-Fenster
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
    attract: 0.6,         // der NÄCHSTE Agent wird angezogen (0..1 zum Cursor)
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
    bri: 0.45,            // Rand-Helligkeit = 1 - bri·f(d)  (Referenz: stark)
    size: 0.08,           // Rand-Größe    = 1 - size·f(d)  (Referenz: subtil)
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

  logo: {                 // LUDI oben mittig (Referenz 08): VIER gleich
    letterH: 0.34,        // große Buchstaben-Agenten, Abstand 0.45 Zellen,
    letterGap: 0.45,      // zentriert über der Bildschirmmitte; D und I
    briLetter: 0.85,      // liegen ÜBER einer normalen Gitter-Kachel
    dunkel: [56, 60, 64], // Farbe von D, I (dunkel auf heller Kachel)
  },

  claws: {                // Rex-Icon: fest verankert in der freien Zelle
    cellFrac: 0.62,       // Größe relativ zur Landing-Zelle (oben rechts)
    bri: 0.62,
    warpSigmaPx: 52,      // das Gitter weicht dem Icon aus (wie dem Cursor)
    warpAmpPx: 28,
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

  p3d: {                  // ECHTES 3D: alles läuft durch eine Lochkamera in
    hFac: 1.4,            // gelockter Draufsicht (Grundlook exakt unverändert,
    dimm: 0.10,           // Perspektive sichtbar wo Tiefe ist). Kamerahöhe =
    zMax: 26,             // hFac·Sichthöhe; dimm = Tiefen-Abdunklung (1/e je
    neigung: 0.55,        // 1/dimm Zellen); neigung = Kippwinkel (rad) des
  },                      // „frei"-Befehls (Perspektive entsperren)

  rex3d: {                // Rex morpht aus den VERBINDUNGSLINIEN des
    breitePx: 270,        // Schwarms (Referenz 12): Linien = Kapsel-Pass,
    posX: 0.68,           // Agenten nur an den Platten-Knotenpunkten.
    posY: 0.58,           // breitePx/pos: screen-fest, rechts unter Mitte
    dickeBasisPx: 0.9,    // Liniendicke der Platte (Referenz 12: zart) …
    dickeKopfPx: 1.8,     // … und im Kopfbereich (mit Transition)
    morphSec: 1.2,        // gerade Gitterlinien → gekrümmte Kopf-Kurven
    skalAussen: 0.5,      // Knoten-Kacheln: außen 0.5 der Kachel → innen 0
    briPlatte: 0.62,      // Draht-Helligkeit der Platte …
    briKoerper: 1.0,      // … und des Körpers (heller)
    kopfAb: 0.15,         // Modell-z, ab dem der Kopf beginnt …
    kopfSpan: 0.7,        // … und wie weich er in den Körper übergeht
    maxYaw: 0.5,          // maximale Kopfdrehung zum Cursor (rad)
    atmen: 0.06,          // subtiles Atmen des Kopf-Drahts (Modell-Einheiten)
  },

  tunnel: {               // „Tunnel" = Schwarzes Loch mit ECHTER Gravita-
    r: 1.5,               // tionslinse (Referenz 10). r = Einstein-Radius
    schluck: 1.3,         // θE (Zellen) = Ring; ·r = leere Quellfläche;
    zug: 2.6,             // Welt-Verdichtung: Reichweite jenseits schluck
    kruemm: 1.6,          // und Exponent — die BÖGEN macht die Linse
    linse: 3.0,           // Linsen-Reichweite in θE (Post-Shader)
    wuchsSec: 1.4,        // das Loch wächst weich ein (nie snappend)
    ringAlpha: 0.6,       // feine Ringlinie (mint, im Shader)
    labelH: 0.30,         // Namens-Label (Zellen)
    dragMin: 10,          // px — mehr Bewegung = Verschieben statt Reise
    flugSec: 2.6,         // Reise: Kamera fliegt smooth hinein, 180° echte
    saug: 0.8,            //   3D-Drehung um die vertikale Achse, Ankunft
    welleKick: 2.2,       //   mit schneller Justier-Welle; saug = Zusatz-
  },                      //   Sog während des Flugs

  verdichtung: {          // Kernfunktion: Fläche verdichtet sich auf 1×1 px
    maxAgenten: 45000,    // Budget — größere Flächen vergröbern den Pitch
    fliessSec: 0.9,       // Sanduhr-Fluss: außen → innen
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
