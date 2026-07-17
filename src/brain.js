// Das GEHIRN von LUDI: Rex, der Dirigent, spricht mit Anthropic-Modellen
// und übersetzt Nutzer-Aufgaben in Schwarm-Formations-Pläne (JSON).
// Direkt aus dem Browser (offizieller CORS-Header). Der API-Key bleibt
// lokal in localStorage und geht ausschließlich an api.anthropic.com.
import { CONFIG } from './config.js';

export function getKey() { return localStorage.getItem(CONFIG.brain.storageKey) || ''; }
export function setKey(k) { localStorage.setItem(CONFIG.brain.storageKey, k.trim()); }
export function clearKey() { localStorage.removeItem(CONFIG.brain.storageKey); }
export function hasKey() { return getKey().length > 10; }

const SYSTEM = (view) => `Du bist Rex, der Dirigent von LudiOS — einem experimentellen Betriebssystem, dessen gesamte Oberfläche ein Schwarm aus Agenten ist (Sichtfeld ${view.w}×${view.h} px, Ursprung oben links, dunkler Grund, hellgraue Squircle-Kacheln, Poppins als Systemschrift, Akzent Türkis [43,239,217]).
Du erhältst eine Aufgabe des Nutzers (optional mit ausgewählter Agenten-Gruppe als Kontext) und antwortest AUSSCHLIESSLICH mit einem JSON-Objekt — kein Markdown, keine Erklärung:
{"say":"kurze antwort an den nutzer, max 90 zeichen, kleinschreibung","commands":[...]}

Verfügbare Kommandos (maximal 12):
{"cmd":"heading","text":"…","x":${Math.round(view.w / 2)},"y":72}
{"cmd":"text","text":"…","x":${Math.round(view.w / 2)},"y":120,"px":12,"color":[r,g,b]}
{"cmd":"panel","x":${Math.round(view.w / 2)},"y":300,"w":420,"h":180,"title":"…","lines":["…","…"]}
{"cmd":"shape","kind":"ring|polygon|spiral|phyllotaxis|lissajous|wave","x":${Math.round(view.w / 2)},"y":300,"r":90,"n":300,"color":[r,g,b],"p1":0,"p2":0}
{"cmd":"color","target":"auswahl","color":[r,g,b]}
{"cmd":"beacon","target":"auswahl"}
{"cmd":"dissolve","target":"auswahl"}
{"cmd":"morph","shape":"squircle|kreis|quadrat"}

Hinweise: heading/text sind um x ZENTRIERT. shape-Parameter p1/p2: polygon=Eckenzahl, spiral=Windungen, lissajous=Frequenzen a/b, wave=Perioden/Amplitude. n ist die Agentenzahl der Figur (≤3000).
Gestaltung: wenig Text, viel Ruhe, nichts überlappen. Nutze Mathematik als Ornament (phyllotaxis als Blüte, ring als Fassung, lissajous als Signatur) statt Kästen. Für reine Antworten ohne UI genügt "say" mit leerem commands-Array.`;

function buildPrompt(task, context) {
  const ctx = context
    ? `Ausgewählte Gruppe: ${context.task} (${context.count} Agenten).`
    : 'Keine Auswahl.';
  return `${ctx}\nAufgabe: "${task}"`;
}

function extractJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('keine JSON-Antwort');
  return JSON.parse(text.slice(a, b + 1));
}

const CMDS = new Set(['heading', 'text', 'panel', 'shape', 'color', 'beacon', 'dissolve', 'morph']);
const KINDS = new Set(['ring', 'polygon', 'spiral', 'phyllotaxis', 'lissajous', 'wave']);
const clampNum = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const col = (c) => (Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number'))
  ? c.map((v) => Math.min(255, Math.max(0, Math.round(v))))
  : undefined;

// Plan härten: Whitelist, Grenzen, Längen — das Gehirn plant, LUDI wacht.
export function validatePlan(raw, view = { w: 800, h: 600 }) {
  const B = CONFIG.brain;
  const plan = { say: '', commands: [] };
  if (typeof raw.say === 'string') plan.say = raw.say.slice(0, 110);
  const cmds = Array.isArray(raw.commands) ? raw.commands.slice(0, B.maxCommands) : [];
  for (const c of cmds) {
    if (!c || typeof c !== 'object' || !CMDS.has(c.cmd)) continue;
    const o = { cmd: c.cmd };
    o.x = clampNum(c.x, 10, view.w - 10) ?? view.w / 2;
    o.y = clampNum(c.y, 10, view.h - 10) ?? view.h / 2;
    o.color = col(c.color);
    if (c.cmd === 'heading' || c.cmd === 'text') {
      if (typeof c.text !== 'string' || !c.text.trim()) continue;
      o.text = c.text.slice(0, 90);
      o.px = clampNum(c.px, 9, 24) ?? (c.cmd === 'heading' ? 19 : 12);
    } else if (c.cmd === 'panel') {
      o.w = clampNum(c.w, 80, view.w - 40) ?? Math.min(400, view.w - 60);
      o.h = clampNum(c.h, 50, view.h - 60) ?? 180;
      o.title = typeof c.title === 'string' ? c.title.slice(0, 48) : '';
      o.lines = Array.isArray(c.lines) ? c.lines.slice(0, 8).map((l) => String(l).slice(0, 64)) : [];
    } else if (c.cmd === 'shape') {
      o.kind = KINDS.has(c.kind) ? c.kind : 'ring';
      o.r = clampNum(c.r, 8, Math.min(view.w, view.h) / 2 - 20) ?? 90;
      o.w = clampNum(c.w, 0, view.w - 40) ?? 0;
      o.h = clampNum(c.h, 0, view.h - 40) ?? 0;
      o.n = Math.round(clampNum(c.n, 12, B.maxShapeAgents) ?? 240);
      o.p1 = clampNum(c.p1, 0, 12) ?? 0;
      o.p2 = clampNum(c.p2, 0, 200) ?? 0;
    } else if (c.cmd === 'morph') {
      if (!['squircle', 'kreis', 'quadrat'].includes(c.shape)) continue;
      o.shape = c.shape;
    }
    plan.commands.push(o);
  }
  return plan;
}

export async function askBrain(task, context, view = { w: 800, h: 600 }) {
  const key = getKey();
  if (!key) throw new Error('kein api-key');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CONFIG.brain.timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CONFIG.brain.model,
        max_tokens: CONFIG.brain.maxTokens,
        system: SYSTEM(view),
        messages: [{ role: 'user', content: buildPrompt(task, context) }],
      }),
    });
    if (!res.ok) {
      throw new Error(`api ${res.status}${res.status === 401 ? ' · key prüfen („key")' : ''}`);
    }
    const json = await res.json();
    const text = (json.content || []).map((c) => c.text || '').join('');
    return validatePlan(extractJson(text), view);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('zeitüberschreitung');
    throw err;
  } finally {
    clearTimeout(to);
  }
}
