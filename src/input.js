// DOM-Events → Screen-/Weltkoordinaten → Dirigent + Kamera.
// Mausrad und Trackpad-Pinch zoomen supersmooth (verankert am Cursor);
// Touch-Pinch über Pointer-Events. Klick öffnet Feld/Karte, ⌘V fügt ein.
// attachInput gibt eine detach()-Funktion zurück (Modus-Wechsel).
import { CONFIG } from './config.js';

export function attachInput(canvas, dirigent, kamera, actions) {
  const toScreen = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (kamera.viewW / r.width),
      y: (e.clientY - r.top) * (kamera.viewH / r.height),
    };
  };

  const pointers = new Map(); // Pinch-Tracking
  let pinchDist = 0;
  let pinched = false;  // unterdrückt den Klick nach einer Geste
  let swipeStart = null; // Swipe-Geste (Apps: 2048 usw.)

  const onPointerDown = (e) => {
    pointers.set(e.pointerId, toScreen(e));
    if (pointers.size === 1) {
      const p = toScreen(e);
      swipeStart = p;
      dirigent.onPointerDown(p.x, p.y);
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinched = true;
      swipeStart = null;
    }
  };
  const onPointerUp = (e) => {
    if (swipeStart && pointers.size === 1) {
      const p = toScreen(e);
      const dx = p.x - swipeStart.x, dy = p.y - swipeStart.y;
      if (Math.hypot(dx, dy) > 36) {
        dirigent.onSwipe(dx, dy);
        pinched = true; // Klick nach Swipe unterdrücken
      }
      swipeStart = null;
    }
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      dirigent.onPointerUp();
      setTimeout(() => { pinched = false; }, 120);
    }
  };
  const onPointerMove = (e) => {
    const p = toScreen(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && !dirigent.zoomLocked) {
        kamera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
      }
      pinchDist = d;
      return;
    }
    dirigent.onPointerMove(p.x, p.y);
    if (pointers.has(e.pointerId)) dirigent.onPointerDrag(p.x, p.y);
  };
  const onPointerLeave = () => dirigent.onPointerLeave();

  const onClick = (e) => {
    if (pinched) return;
    const p = toScreen(e);
    dirigent.onClick(p.x, p.y);
  };

  // Zoom: Mausrad + Trackpad-Pinch (ctrl+wheel), verankert am Cursor
  const onWheel = (e) => {
    e.preventDefault();
    if (dirigent.onWheel(e.deltaY)) return;
    const K = CONFIG.kamera;
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? K.pinchFactor : K.wheelFactor));
    const p = toScreen(e);
    kamera.zoomAt(p.x, p.y, f);
  };

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey) return; // Browser-Shortcuts (inkl. ⌘V)
    if (dirigent.onKey(e)) {
      e.preventDefault();
      return;
    }
    const k = e.key;
    if (k === 'h' || k === 'H') actions.toggleHud();
  };

  const onPaste = (e) => {
    const t = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (t && dirigent.onPaste(t)) e.preventDefault();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', onPaste);

  return function detach() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('paste', onPaste);
  };
}
