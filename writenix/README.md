# Writenix Integration

This folder contains **all outbound HTTP code and payload parsing** that talks
to the Writenix API. If you're sharing code with Writenix's support team, or
debugging **Cloudflare issues** (403s, challenge pages, timeouts), this is the
only file you need:

- **`client.js`** — every `fetch()` call that reaches `app.writenix.com`, plus
  webhook signature verification and payload parsing.

Nothing about our database, payment/wallet logic, or membership system lives
here. `routes/turnitin.js` and `routes/writenix-webhook.js` call into this
module rather than talking to Writenix directly.

---

## What happens when a user submits a document

```
User uploads file
       │
       ▼
 routes/turnitin.js  ─── payment / wallet logic ─── db writes
       │
       ▼
 writenix/client.js  ── submitDocument() ──►  POST https://app.writenix.com/api/v1/documents/process
       │                                              │
       │         ◄── writenixReference ───────────────┘
       ▼
 routes/turnitin.js  ─── saves reference → db, returns to user
```

## What happens when a report is ready

```
Writenix sends webhook  ──►  POST /api/writenix-webhook  (mounted in server.js
                                    │                      BEFORE express.json(),
                                    ▼                      so the raw body Buffer
                              routes/writenix-webhook.js   survives for HMAC)
                                    │
                                    ▼
                              writenix/client.js
                                ── verifyWebhookSignature(signature, rawBody)
                                ── parseWebhookPayload(payload)
                                    │
                                    ▼
                              db update, email notification (with report
                              file(s) attached via downloadReportBuffer)
```

## What happens on download

```
User clicks "Similarity" / "AI Report" in the portal
       │
       ▼
 routes/turnitin.js  ──►  writenix/client.js  ── streamReportToResponse()
                                                   │
                                                   ▼
                                              GET <report_url>  (Writenix-hosted PDF)
                                                   │
                                                   ▼
                                              Proxied to user with a friendly filename
```

---

## Environment variables needed

| Variable                  | Source                            |
|----------------------------|-----------------------------------|
| `WRITENIX_API_KEY`         | Your Writenix developer dashboard |
| `WRITENIX_WEBHOOK_SECRET`  | Your Writenix developer dashboard |

---

## Current status: Cloudflare Managed Challenge (unresolved as of this writing)

Submissions are intermittently blocked by Cloudflare sitting in front of
`app.writenix.com`, returning an HTML "Just a moment..." challenge page
(`cType: 'managed'`) instead of a JSON response. Ray IDs seen so far:

- `a19ac9862ee8fef3`
- `a19ec8df9b6520eb`
- `a2339fd05e3f6e09`

What's already been tried:
- Added `Accept: application/json` and a realistic browser `User-Agent`
  (Writenix's documented fix for generic-bot detection) — did not resolve it.
- Writenix support added a Cloudflare WAF custom rule ("Bypass WAF for
  Authenticated API Traffic", skip action, matching `/api/*` + a header
  condition) — as of this writing its hit count is **0**, meaning it has
  never actually matched a real request from us.

Why the WAF rule likely isn't helping: a **Managed Challenge from Bot
Fight Mode / Super Bot Fight Mode is a different Cloudflare layer than WAF
custom rules**, evaluated earlier in the request pipeline. A rule whose
"Skip" action only covers the WAF Managed Ruleset won't bypass a bot
challenge unless "Bot Fight Mode" is explicitly one of the things ticked to
skip. The 0 hit count also suggests the rule's header-matching condition may
not match what we actually send (see `buildRequestHeaders()` in `client.js`
for the exact headers).

Next steps to raise with Writenix:
1. Confirm whether the WAF rule's "Skip" action includes Bot Fight Mode /
   Super Bot Fight Mode, not just the WAF ruleset.
2. Get the full (uncropped) rule expression to check what header condition
   it's actually testing for.
3. If they want an IP allowlist instead, we need to confirm whether this
   service has a static outbound IP (Render's standard plans don't guarantee
   one), since an IP-based rule would explain "worked once, broke again."

---

## Testing locally

```bash
# From the project root
node -e "
const { submitDocument } = require('./writenix/client');
const fs = require('fs');
const buf = fs.readFileSync('./some-test-file.pdf');
submitDocument(buf, 'test.pdf')
  .then(r => console.log('OK', r))
  .catch(e => console.error('FAIL', e.message));
"
```
