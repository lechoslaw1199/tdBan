import React, { useState } from 'react';

const ADMIN_KEY = 'whapooooSend';

export default function AdminPanel() {
  const [recipient, setRecipient] = useState('');
  const [lang, setLang] = useState('en'); // 'en' | 'fr'
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [message, setMessage] = useState('');

  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

  const handleSend = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!isValidEmail(recipient)) {
      setStatus('error');
      setMessage('Please enter a valid recipient email address.');
      return;
    }

    setStatus('sending');

    try {
      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': ADMIN_KEY,
        },
        body: JSON.stringify({ recipient: recipient.trim(), lang }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus('success');
        setMessage(`Email successfully sent to ${recipient.trim()}`);
        setRecipient('');
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to send email. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      setMessage('Network error. Could not reach the server.');
    }
  };

  const resetStatus = () => {
    setStatus('idle');
    setMessage('');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: '24px',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'fixed',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '600px',
        height: '300px',
        background: 'radial-gradient(ellipse, rgba(22,115,197,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: '480px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '20px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1673C5 0%, #0e4f8a 100%)',
          padding: '28px 32px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
            }}>
              ✉️
            </div>
            <h1 style={{
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: '700',
              margin: 0,
              letterSpacing: '-0.3px',
            }}>
              Email Sender
            </h1>
          </div>
          <p style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: '13px',
            margin: 0,
            paddingLeft: '48px',
          }}>
            Admin panel · Secure access only
          </p>
        </div>

        {/* Form body */}
        <div style={{ padding: '32px' }}>
          <form onSubmit={handleSend}>

            {/* Recipient Email */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                color: 'rgba(255,255,255,0.75)',
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '8px',
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
              }}>
                Recipient Email
              </label>
              <input
                id="admin-recipient"
                type="text"
                value={recipient}
                onChange={(e) => { setRecipient(e.target.value); resetStatus(); }}
                placeholder="target@example.com"
                disabled={status === 'sending'}
                style={{
                  width: '100%',
                  padding: '13px 16px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px',
                  color: '#f1f5f9',
                  fontSize: '15px',
                  outline: 'none',
                  transition: 'border-color 0.2s, background 0.2s',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#1673C5';
                  e.target.style.background = 'rgba(22,115,197,0.08)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.12)';
                  e.target.style.background = 'rgba(255,255,255,0.06)';
                }}
              />
            </div>

            {/* Email Language */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                color: 'rgba(255,255,255,0.75)',
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '8px',
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
              }}>
                Email Language
              </label>
              <div style={{
                display: 'flex',
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: '10px',
                padding: '4px',
                border: '1px solid rgba(255, 255, 255, 0.10)',
              }}>
                <button
                  type="button"
                  onClick={() => { setLang('en'); resetStatus(); }}
                  disabled={status === 'sending'}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: 'none',
                    borderRadius: '7px',
                    background: lang === 'en' ? '#1673C5' : 'transparent',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: status === 'sending' ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                  }}
                >
                  🇺🇸 English
                </button>
                <button
                  type="button"
                  onClick={() => { setLang('fr'); resetStatus(); }}
                  disabled={status === 'sending'}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: 'none',
                    borderRadius: '7px',
                    background: lang === 'fr' ? '#1673C5' : 'transparent',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: status === 'sending' ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                  }}
                >
                  🇫🇷 French
                </button>
              </div>
            </div>

            {/* Status Banner */}
            {message && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                marginBottom: '20px',
                fontSize: '13px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: status === 'success'
                  ? 'rgba(34,197,94,0.12)'
                  : 'rgba(239,68,68,0.12)',
                border: `1px solid ${status === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: status === 'success' ? '#4ade80' : '#f87171',
              }}>
                <span>{status === 'success' ? '✅' : '⚠️'}</span>
                {message}
              </div>
            )}

            {/* Send Button */}
            <button
              type="submit"
              id="admin-send-btn"
              disabled={status === 'sending'}
              style={{
                width: '100%',
                padding: '14px',
                background: status === 'sending'
                  ? 'rgba(22,115,197,0.5)'
                  : 'linear-gradient(135deg, #1673C5 0%, #0e5da3 100%)',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: '700',
                cursor: status === 'sending' ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                letterSpacing: '0.3px',
                boxShadow: status === 'sending' ? 'none' : '0 4px 20px rgba(22,115,197,0.4)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                if (status !== 'sending') {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 6px 25px rgba(22,115,197,0.5)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = status === 'sending' ? 'none' : '0 4px 20px rgba(22,115,197,0.4)';
              }}
            >
              {status === 'sending' ? (
                <>
                  <svg style={{ animation: 'spin 1s linear infinite', width: '18px', height: '18px' }} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Sending...
                </>
              ) : (
                <>
                  <span>📤</span>
                  Send Email
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 32px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          textAlign: 'center',
        }}>
          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '11px', margin: 0 }}>
            🔒 Protected admin route · Unauthorized access is logged
          </p>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.25) !important; }
      `}</style>
    </div>
  );
}
