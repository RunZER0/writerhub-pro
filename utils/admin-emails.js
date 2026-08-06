// Owner accounts. These are the ONLY accounts with unlimited report slots and admin-panel
// access. Staff/writers are deliberately NOT here — they consume slots like any other user.
const ADMIN_BYPASS_EMAILS = new Set([
    'valdaceai@gmail.com',
    'vikkicleo@gmail.com',
    'cleovikkie@gmail.com'
]);

function isAdminBypassEmail(email) {
    if (!email) return false;
    return ADMIN_BYPASS_EMAILS.has(email.toLowerCase().trim());
}

module.exports = {
    ADMIN_BYPASS_EMAILS,
    isAdminBypassEmail,
    // Alias — reads better at call sites that gate on ownership rather than on payment bypass.
    isOwnerEmail: isAdminBypassEmail
};
