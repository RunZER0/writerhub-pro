/**
 * Writenix API Client
 *
 * Every outbound HTTP call to app.writenix.com, and every bit of parsing of
 * data that comes back from them (webhook payloads included), lives in this
 * one file. Nothing about our own database, payment, or membership logic is
 * in here - this is the file to hand to Writenix's team if they ever need to
 * see exactly what we send/receive, without exposing anything else.
 *
 * See README.md in this folder for the request/response lifecycle and the
 * current Cloudflare Managed Challenge situation.
 */

const crypto = require('crypto');
const { Readable } = require('stream');
const { fetch: undiciFetch, ProxyAgent, FormData: UndiciFormData } = require('undici');

let cachedDispatcher = null;
let cachedProxyUrl = null;

function getDispatcher() {
    const proxyUrl = (process.env.WRITENIX_PROXY_URL || '').trim();
    if (!proxyUrl) return undefined;

    if (cachedDispatcher && cachedProxyUrl === proxyUrl) {
        return cachedDispatcher;
    }

    cachedDispatcher = new ProxyAgent({
        uri: proxyUrl,
        connect: {
            timeout: 30000, // 30s connection timeout for residential/ISP proxy
            keepAlive: true,
            keepAliveInitialDelay: 10000
        },
        headersTimeout: 60000,
        bodyTimeout: 60000
    });
    cachedProxyUrl = proxyUrl;
    return cachedDispatcher;
}

function resetDispatcher() {
    if (cachedDispatcher && typeof cachedDispatcher.close === 'function') {
        cachedDispatcher.close().catch(() => {});
    }
    cachedDispatcher = null;
    cachedProxyUrl = null;
}

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
// to avoid their Cloudflare bot protection.
function buildRequestHeaders() {
    return {
        'X-Api-Key': (process.env.WRITENIX_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
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
 * Includes automatic retry on transient network/proxy socket timeouts.
 * @param {Buffer} fileBuffer - raw bytes of the uploaded PDF/DOCX
 * @param {string} originalFilename
 * @param {number} maxRetries - retries on transient network failures (default: 2)
 * @returns {Promise<{ writenixReference: string|null, raw: object }>}
 */
async function submitDocument(fileBuffer, originalFilename, maxRetries = 2) {
    const baseUrl = getBaseUrl();
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const dispatcher = getDispatcher();
        try {
            let response;
            if (dispatcher) {
                const formData = new UndiciFormData();
                formData.append('file', new Blob([fileBuffer]), originalFilename);
                response = await undiciFetch(`${baseUrl}/documents/process`, {
                    method: 'POST',
                    headers: buildRequestHeaders(),
                    body: formData,
                    dispatcher
                });
            } else {
                const formData = new FormData();
                formData.append('file', new Blob([fileBuffer]), originalFilename);
                response = await fetch(`${baseUrl}/documents/process`, {
                    method: 'POST',
                    headers: buildRequestHeaders(),
                    body: formData
                });
            }

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                let errJson = null;
                try { errJson = JSON.parse(errBody); } catch (_) {}
                if (errJson && errJson.message) {
                    throw new Error(`Writenix API error (${response.status}): ${errJson.message}`);
                }
                if (response.status === 403) {
                    throw new Error(`Writenix request blocked by Cloudflare (403). Ensure WRITENIX_PROXY_URL or bypass rules are configured: ${errBody.slice(0, 200)}`);
                }
                if (response.status === 402) {
                    throw new Error(`Writenix account is out of report slots (402). Please recharge your account at app.writenix.com.`);
                }
                throw new Error(`Writenix returned ${response.status}: ${errBody}`);
            }

            const data = await response.json().catch(() => ({}));
            const writenixReference = data.report_id || data.reference || data.document_id || data.id || null;
            return { writenixReference, raw: data };
        } catch (err) {
            lastError = err;

            // Never retry validation / auth / account errors
            const isApiError = err.message && (
                err.message.startsWith('Writenix API error') ||
                err.message.startsWith('Writenix account is out of report slots') ||
                err.message.startsWith('Writenix request blocked')
            );
            if (isApiError || attempt > maxRetries) {
                break;
            }

            const causeDetail = err.cause?.message || err.cause?.code || '';
            console.warn(`Writenix submission attempt ${attempt} failed (${err.message}${causeDetail ? ': ' + causeDetail : ''}). Retrying in 1.5s...`);
            resetDispatcher();
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    const causeMsg = lastError?.cause?.message || lastError?.cause?.code;
    const enrichedMessage = causeMsg
        ? `${lastError.message} (${causeMsg})`
        : lastError.message;
    const finalError = new Error(enrichedMessage);
    finalError.cause = lastError.cause;
    throw finalError;
}

/**
 * Fetch the current status of a document from Writenix.
 * Useful for recovering reports where the webhook was missed.
 * @param {string} writenixReference
 * @returns {Promise<{ status: string, raw: object }>}
 */
async function getReportStatus(writenixReference) {
    try {
        const baseUrl = getBaseUrl();
        const dispatcher = getDispatcher();
        const response = await (dispatcher ? undiciFetch : fetch)(`${baseUrl}/documents/${writenixReference}`, {
            method: 'GET',
            headers: buildRequestHeaders(),
            ...(dispatcher ? { dispatcher } : {})
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            console.warn(`Writenix GET status returned ${response.status} (Writenix is webhook-driven): ${errBody.slice(0, 100)}`);
            return { status: 'processing', raw: {} };
        }

        const data = await response.json().catch(() => ({}));
        return { status: data.status || data.state || 'processing', raw: data };
    } catch (err) {
        console.warn(`Writenix GET status check skipped: ${err.message}`);
        return { status: 'processing', raw: {} };
    }
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
 * Extract the fields we care about from a parsed webhook payload.
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
    
    const parseScore = (val) => {
        if (val === null || val === undefined || val === '' || val === 'N/A') return null;
        const num = Number(val);
        return Number.isNaN(num) ? null : num;
    };

    const rawSimScore = payload.plagiarism_score ?? payload.data?.plagiarism_score;
    const rawAiScore = payload.ai_score ?? payload.data?.ai_score;

    const similarityScore = parseScore(rawSimScore);
    const aiScore = parseScore(rawAiScore);

    return { event, writenixRef, similarityReportUrl, aiReportUrl, similarityScore, aiScore };
}

/**
 * Fetch a report file's raw bytes (used for email attachments).
 * @param {string} reportUrl
 * @returns {Promise<Buffer|null>} null if the URL is missing or the fetch fails
 */
async function downloadReportBuffer(reportUrl) {
    if (!reportUrl) return null;
    const dispatcher = getDispatcher();
    const response = await (dispatcher ? undiciFetch : fetch)(reportUrl, {
        ...(dispatcher ? { dispatcher } : {})
    });
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
        const dispatcher = getDispatcher();
        const upstream = await (dispatcher ? undiciFetch : fetch)(reportUrl, {
            ...(dispatcher ? { dispatcher } : {})
        });
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
    streamReportToResponse,
    getReportStatus
};
