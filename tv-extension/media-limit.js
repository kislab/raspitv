// Videoformate begrenzen, die der Raspberry Pi 4 flüssig abspielen kann (läuft in der Seite selbst,
// vor deren Skripten). Ohne Hardware-Dekoder schafft der Pi AV1 und VP9 nicht in Echtzeit –
// YouTube wählt dann H.264 mit höchstens 1080p und 30 Bildern pro Sekunde.
(() => {
  const MAX_HEIGHT = 1080;
  const MAX_FPS = 30;
  const BLOCKED = /av01|vp0?9|vp8|hev1|hvc1|dvh/i;

  function allowed(type) {
    if (typeof type !== "string") return true;
    if (!/^video\//i.test(type)) return true; // Ton unverändert
    if (BLOCKED.test(type)) return false;
    const num = (name) => {
      const m = type.match(new RegExp(`[;\\s]${name}=([\\d.]+)`, "i"));
      return m ? parseFloat(m[1]) : 0;
    };
    if (num("height") > MAX_HEIGHT || num("width") > MAX_HEIGHT * 16 / 9) return false;
    if (num("framerate") > MAX_FPS) return false;
    return true;
  }

  const MS = window.MediaSource;
  if (MS && MS.isTypeSupported) {
    const original = MS.isTypeSupported.bind(MS);
    MS.isTypeSupported = (type) => allowed(type) && original(type);
  }
  const ManagedMS = window.ManagedMediaSource;
  if (ManagedMS && ManagedMS.isTypeSupported) {
    const original = ManagedMS.isTypeSupported.bind(ManagedMS);
    ManagedMS.isTypeSupported = (type) => allowed(type) && original(type);
  }
  const canPlay = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    return allowed(type) ? canPlay.call(this, type) : "";
  };
  const caps = navigator.mediaCapabilities;
  if (caps && caps.decodingInfo) {
    const original = caps.decodingInfo.bind(caps);
    caps.decodingInfo = (config) => {
      const v = config && config.video;
      const tooMuch = v && (BLOCKED.test(v.contentType || "") || v.height > MAX_HEIGHT || v.framerate > MAX_FPS);
      if (tooMuch) return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
      return original(config);
    };
  }
})();
