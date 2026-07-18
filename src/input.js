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
  let pinchMid = null;
  let pinched = false;  // unterdrückt den Klick nach einer Geste
  let swipeStart = null; // Swipe-Geste (Apps: 2048 usw.)
  let panDrag = null;   // Pan mit gedrückter mittlerer Maustaste

  const onPointerDown = (e) => {
    if (e.button === 1) { // mittlere Maustaste: Pan-Navigation
      e.preventDefault();
      panDrag = toScreen(e);
      pinched = true;
      dirigent.notifyAction();
      return;
    }
    pointers.set(e.pointerId, toScreen(e));
    if (pointers.size === 1) {
      const p = toScreen(e);
      swipeStart = p;
      dirigent.onPointerDown(p.x, p.y);
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinched = true;
      swipeStart = null;
      dirigent.notifyAction();
    }
  };
  const onPointerUp = (e) => {
    if (panDrag) {
      panDrag = null;
      setTimeout(() => { pinched = false; }, 120);
      return;
    }
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
    if (panDrag) { // mittlere Maustaste zieht die Welt
      if (!dirigent.zoomLocked) {
        kamera.pan((panDrag.x - p.x) / kamera.scale, (panDrag.y - p.y) / kamera.scale);
      }
      panDrag = p;
      return;
    }
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pointers.size === 2) { // 2-Finger: Pinch zoomt, Bewegung schiebt
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0 && !dirigent.zoomLocked) {
        kamera.zoomAt(mid.x, mid.y, d / pinchDist);
        if (pinchMid) {
          kamera.pan((pinchMid.x - mid.x) / kamera.scale, (pinchMid.y - mid.y) / kamera.scale);
        }
      }
      pinchDist = d;
      pinchMid = mid;
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

  // Rad/Trackpad: Pinch (ctrl) und klassisches Mausrad zoomen, die
  // 2-Finger-Geste des Trackpads (feine/diagonale Deltas) verschiebt
  const onWheel = (e) => {
    e.preventDefault();
    if (dirigent.onWheel(e.deltaY)) return;
    dirigent.notifyAction();
    if (dirigent.zoomLocked) return;
    const K = CONFIG.kamera;
    const p = toScreen(e);
    const mausRad = e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
    if (e.ctrlKey || mausRad) {
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? K.pinchFactor : K.wheelFactor));
      kamera.zoomAt(p.x, p.y, f);
    } else {
      kamera.pan(e.deltaX / kamera.scale, e.deltaY / kamera.scale);
    }
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
