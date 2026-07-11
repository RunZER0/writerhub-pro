// Emails that bypass payment/verification gates across the app (e.g. free Turnitin checks).
const ADMIN_BYPASS_EMAILS = new Set([
    'valdaceai@gmail.com',
    'vikkicleo@gmail.com',
    'cleovikkie@gmail.com'
]);

function isAdminBypassEmail(email) {
    if (!email) return false;
    return ADMIN_BYPASS_EMAILS.has(email.toLowerCase().trim());
}

module.exports = { ADMIN_BYPASS_EMAILS, isAdminBypassEmail };
