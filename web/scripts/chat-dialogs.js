// Modal and visual helper services
export function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const bootstrap = window.bootstrap;
  if (bootstrap && bootstrap.Modal) {
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.show();
  }
}

export function hideModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const bootstrap = window.bootstrap;
  if (bootstrap && bootstrap.Modal) {
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.hide();
  }
}

export function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (err) {
    console.warn("Audio feedback play failed:", err);
  }
}

export function hideSplashLoader() {
  const loader = document.getElementById("app-splash-loader");
  if (loader) {
    loader.style.opacity = "0";
    loader.style.visibility = "hidden";
    setTimeout(() => {
      loader.remove();
    }, 400);
  }
}
