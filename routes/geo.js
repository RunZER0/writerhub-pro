const express = require('express');
const router = express.Router();

// Server-side geo-IP lookup. Client-side third-party geo APIs have repeatedly failed here:
// ip-api.com blocks HTTPS outright on its free tier (403), and ipapi.co doesn't send
// Access-Control-Allow-Origin, so browsers silently block JS from reading the response even
// though the request itself succeeds. Doing this server-to-server sidesteps CORS entirely and
// gives us visibility via our own logs if a provider ever misbehaves again.
router.get('/', async (req, res) => {
    try {
        // req.ip reflects the real visitor IP (via X-Forwarded-For) only because
        // `app.set('trust proxy', true)` is set in server.js — Render sits behind a proxy.
        const ip = req.ip || '';
        const isPrivate = !ip || ip === '::1' || ip === '127.0.0.1' ||
            ip.startsWith('::ffff:127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');

        if (isPrivate) {
            return res.json({ countryCode: null });
        }

        const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
        const data = await response.json();

        if (!data.success) {
            console.error('Geo lookup failed for IP', ip, ':', data.message || 'unknown reason');
            return res.json({ countryCode: null });
        }

        res.json({ countryCode: data.country_code || null });
    } catch (error) {
        console.error('Geo lookup error:', error.message);
        res.json({ countryCode: null });
    }
});

module.exports = router;
