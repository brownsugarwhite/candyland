// FÜLLUNG: austauschbares Provider-Interface für generative Pfad-Füllung
// (Referenz: Illustrator + Adobe Firefly Generative Fill).
//   provider.fill({ maskCanvas, prompt }) → Promise<CanvasImageSource>
// Ohne Zugang läuft der Mock-Provider (prozeduraler Verlauf aus dem
// Prompt). Der Firefly-Provider spricht die offizielle Firefly Services
// „Fill Image"-API an — die braucht einen serverseitigen Token-Proxy
// (Client-Secret gehört nie in den Browser); bis dahin erklärt er das.
import { CONFIG } from './config.js';

// deterministischer Hash → zwei Farbtöne aus dem Prompt
function hashPrompt(prompt) {
  let h = 2166136261;
  for (const ch of prompt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export const mockProvider = {
  name: 'mock',
  async fill({ maskCanvas, prompt }) {
    const w = maskCanvas.width, h = maskCanvas.height;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const seed = hashPrompt(prompt || 'ludi');
    const h1 = seed % 360;
    const h2 = (h1 + 40 + (seed >> 8) % 140) % 360;
    const grad = ctx.createLinearGradient(0, 0, w * 0.4, h);
    grad.addColorStop(0, `hsl(${h1} 78% 62%)`);
    grad.addColorStop(1, `hsl(${h2} 72% 42%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // sanfte organische Flecken als „Struktur"
    ctx.globalAlpha = 0.22;
    for (let k = 0; k < 26; k++) {
      const r = (((seed >> (k % 16)) & 255) / 255);
      ctx.fillStyle = `hsl(${(h1 + k * 17) % 360} 70% ${38 + r * 40}%)`;
      ctx.beginPath();
      ctx.ellipse(
        (Math.imul(seed, k + 3) >>> 16) % w,
        (Math.imul(seed, k + 7) >>> 12) % h,
        w * (0.06 + r * 0.16), h * (0.05 + r * 0.12),
        r * 3, 0, Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return cv;
  },
};

export const fireflyProvider = {
  name: 'firefly',
  async fill({ maskCanvas, prompt }) {
    const token = localStorage.getItem('ludi-firefly-token') || '';
    if (!token) {
      throw new Error('firefly braucht einen token-proxy — mock übernimmt („key" für claude, firefly folgt)');
    }
    // Firefly Services „Fill Image": Bild + Maske hochladen, dann
    // generativ füllen. Struktur vorbereitet; Upload-Endpunkte folgen
    // mit dem Server-Proxy.
    const res = await fetch('https://firefly-api.adobe.io/v3/images/fill', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': localStorage.getItem('ludi-firefly-client') || '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: { text: prompt } }),
    });
    if (!res.ok) throw new Error('firefly api ' + res.status);
    const json = await res.json();
    const url = json?.outputs?.[0]?.image?.url;
    if (!url) throw new Error('firefly: keine bildantwort');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((ok, err) => {
      img.onload = ok;
      img.onerror = err;
      img.src = url;
    });
    return img;
  },
};

// aktiver Provider: Firefly sobald eingerichtet, sonst Mock
export function activeProvider() {
  return localStorage.getItem('ludi-firefly-token') ? fireflyProvider : mockProvider;
}
