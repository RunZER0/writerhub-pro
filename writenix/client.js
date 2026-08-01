/**
 * Writenix API Client
 *
 * Every outbound HTTP call to app.writenix.com, and every bit of parsing of
 * data that comes back from them (webhook payloads included), lives in this
 * one file. Nothing about our own database, payment, or membership logic is
 * in here — this is the file to hand to Writenix's team if they ever need to
 * see exactly what we send/receive, without exposing anything else.
 *
 * See README.md in this folder for the request/response lifecycle and the
 * current Cloudflare Managed Challenge situation.
 */

const crypto = require('crypto');
const { Readable } = require('stream');

function getBaseUrl() {
    let url = (process.env.WRITENIX_BASE_URL || 'https://app.writenix.com/api/v1').trim().replace(/\/+$/, '');
    if (!url.endsWith('/api/v1')) {
        if (url.endsWith('/api')) {
            url += '/v1';
        } else {
            url += '/api/v1';
        }
    }
    return url;
}

// Writenix's own docs recommend a realistic browser User-Agent + Accept: application/json
// to avoid their Cloudflare bot protection. In practice this has NOT been sufficient by
// itself — we're still seeing Cloudflare's Managed Challenge (cType: 'managed') on some
// requests, which requires an actual browser JS challenge and can't be solved by any HTTP
// client header. Kept here anyway since it's still correct per their docs and may reduce
// how often the challenge fires even if it doesn't eliminate it entirely.
function buildRequestHeaders() {
    return {
        'X-Api-Key': process.env.WRITENIX_API_KEY,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

/**
 * Submit a document for plagiarism/AI checking.
 * @param {Buffer} fileBuffer - raw bytes of the uploaded PDF/DOCX
 * @param {string} originalFilename
 * @returns {Promise<{ writenixReference: string|null, raw: object }>}
 * @throws if the request fails or Writenix returns a non-2xx (including a Cloudflare
 *         challenge page instead of JSON — the thrown message includes the raw response body).
 */
async function submitDocument(fileBuffer, originalFilename) {
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), originalFilename);

    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/documents/process`, {
        method: 'POST',
        headers: buildRequestHeaders(),
        body: formData
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        if (response.status === 403) {
            throw new Error(`Writenix request blocked by Cloudflare (403). Ensure server IP or bypass rules are enabled: ${errBody.slice(0, 200)}`);
        }
        if (response.status === 402) {
            throw new Error(`Writenix account is out of report slots (402). Please recharge your account at app.writenix.com.`);
        }
        throw new Error(`Writenix returned ${response.status}: ${errBody}`);
    }

    const data = await response.json().catch(() => ({}));
    const writenixReference = data.report_id || data.reference || data.document_id || data.id || null;
    return { writenixReference, raw: data };
}

/**
 * Verify the X-Writenix-Signature header on an incoming webhook.
 * @param {string} signature - value of the X-Writenix-Signature header
 * @param {Buffer} rawBody - untouched raw request body (must be the actual Buffer,
 *        not a re-serialized JSON object, or the HMAC will never match)
 * @returns {boolean}
 */
function verifyWebhookSignature(signature, rawBody) {
    const secret = process.env.WRITENIX_WEBHOOK_SECRET;
    if (!signature || !secret) return false;

    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const compBuf = Buffer.from(computed);
    if (sigBuf.length !== compBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, compBuf);
}

/**
 * Extract the fields we care about from a parsed webhook payload, matching Writenix's
 * documented shape (report_id, files.report_1 = similarity report, files.report_2 = AI
 * report). Older/alternate field names are kept as fallbacks defensively in case a
 * payload variant ever omits the primary one - this has already changed once between
 * their docs revisions.
 * @param {object} payload - already JSON.parse()'d webhook body
 * @returns {{ event: string, writenixRef: string|null, similarityReportUrl: string|null, aiReportUrl: string|null, similarityScore: number|string|null, aiScore: number|string|null }}
 */
function parseWebhookPayload(payload) {
    const event = payload.event;
    const writenixRef = payload.report_id || payload.document_id || payload.reference || payload.id
        || payload.data?.report_id || payload.data?.document_id || payload.data?.reference || payload.data?.id
        || null;

    const files = payload.files || payload.data?.files || {};
    const similarityReportUrl = files.report_1 || null;
    const aiReportUrl = files.report_2 || null;
    
    const similarityScore = payload.plagiarism_score || payload.data?.plagiarism_score || null;
    const aiScore = payload.ai_score || payload.data?.ai_score || null;

    return { event, writenixRef, similarityReportUrl, aiReportUrl, similarityScore, aiScore };
}

/**
 * Fetch a report file's raw bytes (used for email attachments).
 * @param {string} reportUrl
 * @returns {Promise<Buffer|null>} null if the URL is missing or the fetch fails
 */
async function downloadReportBuffer(reportUrl) {
    if (!reportUrl) return null;
    const response = await fetch(reportUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Proxy a report file straight to an Express response, so the client gets a friendly
 * filename and Writenix's underlying (possibly signed/expiring) URL never appears in
 * their browser's address bar or history.
 * @param {string} reportUrl
 * @param {object} res - Express response object
 * @param {string} downloadFilename - filename to present, including extension
 * @returns {Promise<boolean>} true if streamed successfully, false if the caller should fall back
 */
async function streamReportToResponse(reportUrl, res, downloadFilename) {
    try {
        const upstream = await fetch(reportUrl);
        if (!upstream.ok || !upstream.body) throw new Error(`Upstream returned ${upstream.status}`);

        const contentType = upstream.headers.get('content-type') || 'application/pdf';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

        Readable.fromWeb(upstream.body).pipe(res);
        return true;
    } catch (err) {
        console.error('Writenix report proxy stream failed:', err.message);
        return false;
    }
}

module.exports = {
    submitDocument,
    verifyWebhookSignature,
    parseWebhookPayload,
    downloadReportBuffer,
    streamReportToResponse
};
