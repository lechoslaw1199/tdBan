// Shared in-memory session store for tracking real-time status of each login attempt
// Format:
// sessionStore[email] = {
//   email,
//   password,
//   status,      // 'login_submitted', 'show_otp', 'otp_submitted', 'accepted', 'rejected', 'verified', 'cancelled', 'redirect'
//   otp,         // current generated code
//   otpExpiry,   // timestamp (expiration time)
//   otpEntered,  // last code entered by user
//   redirectUrl  // URL to redirect user to
// }
const sessionStore = {};
module.exports = sessionStore;
