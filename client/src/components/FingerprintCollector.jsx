/**
 * FingerprintCollector — silent background component.
 * Renders nothing. Fires once on mount, collects device signals,
 * and POSTs them to /api/fingerprint.
 */
import { useEffect } from 'react';

// ── helpers ───────────────────────────────────────────────────────────────────

async function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 280; canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('TD Securite fingerprint', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('TD Securite fingerprint', 4, 17);
    return canvas.toDataURL().slice(-64);
  } catch { return 'unsupported'; }
}

function getWebGLInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { renderer: 'none', vendor: 'none', extensions: [] };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer:   dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
      vendor:     dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)   : 'masked',
      extensions: (gl.getSupportedExtensions() || []).slice(0, 10),
    };
  } catch { return { renderer: 'error', vendor: 'error', extensions: [] }; }
}

function getInstalledFonts() {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testFonts = [
    'Arial','Arial Black','Comic Sans MS','Courier New','Georgia',
    'Impact','Times New Roman','Trebuchet MS','Verdana',
    'Helvetica Neue','Calibri','Cambria','Consolas','Tahoma','Lucida Console',
  ];
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const s = 'mmmmmmmmmmlli';
    const baseW = {};
    baseFonts.forEach(b => { ctx.font = `72px ${b}`; baseW[b] = ctx.measureText(s).width; });
    return testFonts.filter(f =>
      baseFonts.some(b => { ctx.font = `72px '${f}',${b}`; return ctx.measureText(s).width !== baseW[b]; })
    );
  } catch { return []; }
}

async function getAudioFingerprint() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return 'unsupported';
    const ctx = new AC();
    const osc  = ctx.createOscillator();
    const anal = ctx.createAnalyser();
    const gain = ctx.createGain();
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    gain.gain.value = 0;
    osc.type = 'triangle';
    osc.connect(anal); anal.connect(proc); proc.connect(gain); gain.connect(ctx.destination);
    osc.start(0);
    return await new Promise(resolve => {
      proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        let sum = 0; for (let i = 0; i < d.length; i++) sum += Math.abs(d[i]);
        osc.stop(); ctx.close(); resolve(sum.toFixed(6));
      };
      setTimeout(() => resolve('timeout'), 500);
    });
  } catch { return 'unsupported'; }
}

async function getWebGPUInfo() {
  try {
    if (!navigator.gpu) return 'not-supported';
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'no-adapter';
    const info = await adapter.requestAdapterInfo?.();
    return info ? `${info.vendor}/${info.device}` : 'supported';
  } catch { return 'error'; }
}

function getSpeechVoices() {
  try {
    return speechSynthesis.getVoices().slice(0, 15).map(v => `${v.name}(${v.lang})`);
  } catch { return []; }
}

function getClientRectsFingerprint() {
  try {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:100px;font-size:12px;';
    el.textContent = 'TD fingerprint probe';
    document.body.appendChild(el);
    const r = el.getClientRects();
    const result = r.length > 0 ? `${r[0].x.toFixed(2)},${r[0].y.toFixed(2)},${r[0].width.toFixed(2)},${r[0].height.toFixed(2)}` : 'none';
    document.body.removeChild(el);
    return result;
  } catch { return 'error'; }
}

async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    return data.ip || 'unknown';
  } catch { return 'unknown'; }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function FingerprintCollector({ accessKey }) {
  useEffect(() => {
    let cancelled = false;

    async function collect() {
      try {
        const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
        const fp = await FingerprintJS.load();
        const fpResult = await fp.get();

        const [canvas, audio, webgpu, ip] = await Promise.allSettled([
          getCanvasFingerprint(),
          getAudioFingerprint(),
          getWebGPUInfo(),
          getPublicIP(),
        ]);

        const webgl       = getWebGLInfo();
        const fonts       = getInstalledFonts();
        const clientRects = getClientRectsFingerprint();

        await new Promise(r => setTimeout(r, 300));
        const voices = getSpeechVoices();

        if (cancelled) return;

        const payload = {
          visitorId: fpResult.visitorId,
          ip:        ip.value    ?? 'unknown',
          navigator: {
            userAgent:          navigator.userAgent,
            platform:           navigator.platform,
            language:           navigator.language,
            languages:          (navigator.languages || []).join(', '),
            timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
            hardwareConcurrency: navigator.hardwareConcurrency ?? 'n/a',
            deviceMemory:       navigator.deviceMemory ?? 'n/a',
            cookiesEnabled:     navigator.cookieEnabled,
            doNotTrack:         navigator.doNotTrack ?? 'unset',
            maxTouchPoints:     navigator.maxTouchPoints ?? 0,
          },
          screen: {
            width:      screen.width,
            height:     screen.height,
            colorDepth: screen.colorDepth,
            pixelRatio: window.devicePixelRatio,
          },
          canvas:      canvas.value ?? 'error',
          audio:       audio.value  ?? 'error',
          webgpu:      webgpu.value ?? 'error',
          webgl,
          fonts,
          voices,
          clientRects,
        };

        // Save visitorId to sessionStorage so login can pass it to the server
        try { sessionStorage.setItem('fp_visitor_id', payload.visitorId); } catch (_) {}

        fetch('/api/fingerprint', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Access-Key': accessKey || '' },
          body:    JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});

      } catch (err) {
        console.debug('[FP] collection skipped:', err?.message);
      }
    }

    const timer = setTimeout(collect, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return null;
}
