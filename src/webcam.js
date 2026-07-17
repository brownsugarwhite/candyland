// Webcam-Zugang + generischer Frame-Sampler.
// startCamera liefert ein abspielendes <video>-Element (Selfie-Kamera),
// sampleSource rastert eine beliebige CanvasImageSource auf w×h Pixel.
let stream = null;
let video = null;

export async function startCamera() {
  if (video) return video;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
    audio: false,
  });
  video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((res) => video.addEventListener('loadedmetadata', res, { once: true }));
  }
  return video;
}

export function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  video = null;
}

const cv = document.createElement('canvas');
const ctx = cv.getContext('2d', { willReadFrequently: true });

// → Uint8ClampedArray RGBA (w·h·4). mirror=true spiegelt horizontal (Selfie).
export function sampleSource(source, w, h, mirror = false) {
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  ctx.restore();
  return ctx.getImageData(0, 0, w, h).data;
}

// Quellabmessungen (Video vs. Bild/Canvas)
export function sourceSize(source) {
  return {
    w: source.videoWidth || source.width || 0,
    h: source.videoHeight || source.height || 0,
  };
}
