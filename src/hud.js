// Dev-HUD (nur Statistik, Taste h) — die eigentliche Agenten-Inspektion
// lebt IM Schwarm (Agentenkarte). Zeigt auch die gehoverte Agenten-Id:
// sie bleibt beim Zoomen konstant (Beweis der stabilen Identität).
export function createHud() {
  const el = document.createElement('div');
  el.id = 'hud';
  el.style.cssText = [
    'position:fixed', 'top:10px', 'left:12px',
    'color:#9aa0a3', 'font:11px ui-monospace,Menlo,monospace',
    'letter-spacing:.06em', 'pointer-events:none', 'white-space:pre',
    'display:none', 'z-index:9',
  ].join(';');
  document.body.appendChild(el);
  let visible = false;

  return {
    toggle() {
      visible = !visible;
      el.style.display = visible ? 'block' : 'none';
    },
    update({ fps, wach, slots, mode, renderer, zoom, hovered }) {
      if (!visible) return;
      el.textContent =
        `LUDI · ${Math.round(fps)} fps · ${renderer}\n` +
        `${wach.toLocaleString('de-DE')} wach / ${slots.toLocaleString('de-DE')} slots\n` +
        `${mode.toLowerCase()} · zoom ${zoom.toFixed(1)} px/zelle\n` +
        `hover ${hovered >= 0 ? '#' + hovered : '—'}`;
    },
    get visible() { return visible; },
  };
}
