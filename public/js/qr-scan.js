/* Phone camera QR scanner.
   startQrScanner(videoEl, onCode) → Promise<stop()>.
   Uses the browser's BarcodeDetector where it exists (Chrome on Android), else jsQR (/vendor/jsQR.js),
   since iPhone browsers have no BarcodeDetector. The camera needs HTTPS and a tap to start (iOS). */

(function () {
  let jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    if (!jsqrLoading) jsqrLoading = new Promise((ok, fail) => { const s = document.createElement('script'); s.src = '/vendor/jsQR.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
    return jsqrLoading;
  }

  window.startQrScanner = async function (video, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the camera — type the code instead.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
    await video.play();
    let stopped = false, last = '', lastAt = 0;
    const emit = (txt) => { const now = Date.now(); if (txt && (txt !== last || now - lastAt > 2500)) { last = txt; lastAt = now; onCode(txt); } };

    let detector = null;
    if ('BarcodeDetector' in window) {
      try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
    }
    if (!detector) await loadJsQR();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function tick() {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes[0]) emit(codes[0].rawValue);
          } else if (window.jsQR) {
            const w = video.videoWidth, h = video.videoHeight, scale = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r && r.data) emit(r.data);
          }
        }
      } catch { /* keep scanning */ }
      setTimeout(() => requestAnimationFrame(tick), 120);
    }
    tick();
    return function stop() { stopped = true; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  };
})();
