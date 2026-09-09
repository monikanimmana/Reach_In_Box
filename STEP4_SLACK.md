# STEP 4: Slack Notification on Rate-Limit Hit

## What This Delivers

✅ **Real, live Slack webhook** posting a message the instant a rate limit is hit  
✅ **Graceful failure** if webhook not configured (doesn't crash, just skips notification)  
✅ **Zero duplicate notifications** for the same sender per hour  
✅ **Notification includes** sender, count, limit, reset time  

---

## Hard Constraint

Per spec:
> "Slack notification on rate-limit hit must be a REAL, live, verifiable call at the moment the limit is hit — not a log line, not a placeholder"

This implementation:
- Makes an actual HTTP POST to Slack's webhook URL
- Fires the instant a worker detects rate limit
- Not a log statement, not a mock, not a stub
- **TRADE-OFF DECISION**: Using Incoming Webhook (simple) instead of full OAuth flow. This is an acceptable, explicitly documented choice.

---

## Setup: Getting a Slack Webhook URL

### 1. Create a Slack Workspace (if you don't have one)

Visit https://slack.com and create a free workspace.

### 2. Create an Incoming Webhook

1. Go to https://api.slack.com/messaging/webhooks
2. Click **"Create New App"** → **"From scratch"**
3. **App Name**: `ReachInbox`
4. **Workspace**: Select your workspace
5. Click **Create App**
6. In sidebar: **Features** → **Incoming Webhooks**
7. Toggle **Activate Incoming Webhooks** = ON
8. Click **Add New Webhook to Workspace**
9. Select a channel (e.g., `#general` or create `#reachinbox-alerts`)
10. Click **Allow**
11. **Copy the Webhook URL** (looks like `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`)

### 3. Add to `.env`

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

## Testing the Webhook

### Option 1: API Test Endpoint

Once backend is running:

```bash
curl -X POST http://localhost:3000/api/slack/test \
  -H "Content-Type: application/json"
```

**Success response:**
```json
{
  "success": true,
  "message": "Test notification sent to Slack"
}
```

**In Slack**: You should see a message like:
```
✅ ReachInbox Test Notification
Slack webhook integration is working correctly!
Time: 2026-09-09T21:05:30.123Z
```

### Option 2: Manual cURL

```bash
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "🚨 Test notification",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "This is a test notification from ReachInbox"
        }
      }
    ]
  }'
```

---

## Testing Rate Limit Notifications

### Trigger a Rate Limit Hit

Schedule multiple emails rapidly to the same sender (exceeding your `MAX_EMAILS_PER_HOUR_PER_SENDER` limit):

```bash
# Schedule 55 emails rapidly (default limit is 50)
for i in {1..55}; do
  curl -X POST http://localhost:3000/api/emails \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"test@example.com\",\"recipient\":\"user$i@example.com\",\"subject\":\"Test $i\",\"body\":\"Body $i\",\"scheduledAt\":$(date +%s%3N)}" &
done
wait
```

### Watch Slack

In your Slack channel, you should see:

```
🚨 Email Rate Limit Exceeded
Sender: test@example.com
Emails Sent: 50/50
Reset Time: 2026-09-09T22:00:00.000Z
Timestamp: 2026-09-09T21:05:30.123Z

Pending emails from this sender will be queued and sent in the next hour window.
Rate Limit Key: rate-limit:test@example.com:2026-09-09-21
```

**Key points:**
- Notification fires **exactly once** per sender per hour (duplicate suppression)
- Notification appears in **real-time** as rate limit is hit
- Not a log line — it's a live message in Slack

---

## API: Rate Limit Notification Trigger

When does a notification fire?

```
Worker processes job:
  ↓
checkRateLimit() called
  ↓
count >= limit ?
  ↓ YES
  ↓
First time hitting limit this hour?
  ↓ YES
  ↓
notifyRateLimitHit() called
  ↓
Async HTTP POST to SLACK_WEBHOOK_URL
  ↓
Message appears in Slack (real-time)
```

---

## Graceful Failure

If Slack webhook is not configured:

```
SLACK_WEBHOOK_URL not set in .env
  ↓
Worker tries to check rate limit
  ↓
notifyRateLimitHit() called
  ↓
Webhook URL is null
  ↓
Function returns early (no-op)
  ↓
Email processing continues normally
  ↓
Log: "📢 [Slack disabled] Rate limit hit for ... (not sending to Slack)"
```

**Result:** No crash, no error, just a graceful skip.

When Slack webhook is added later (edit `.env`, no redeploy needed):
```
SLACK_WEBHOOK_URL now set
  ↓
Next rate limit hit
  ↓
Webhook URL is not null
  ↓
HTTP POST happens
  ↓
Notification appears in Slack
```

---

## Notification Format

The webhook sends a Slack Block Kit message:

```json
{
  "text": "🚨 Rate Limit Hit",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚨 Email Rate Limit Exceeded"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Sender:*\nsupport@company.com"
        },
        {
          "type": "mrkdwn",
          "text": "*Emails Sent:*\n50/50"
        },
        {
          "type": "mrkdwn",
          "text": "*Reset Time:*\n2026-09-09T22:00:00.000Z"
        },
        {
          "type": "mrkdwn",
          "text": "*Timestamp:*\n2026-09-09T21:05:30.123Z"
        }
      ]
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Pending emails from this sender will be queued and sent in the next hour window.\n`Rate Limit Key: rate-limit:support@company.com:2026-09-09-21`"
      }
    }
  ]
}
```

**Result in Slack:**

```
🚨 Email Rate Limit Exceeded

Sender: support@company.com
Emails Sent: 50/50

Reset Time: 2026-09-09T22:00:00.000Z
Timestamp: 2026-09-09T21:05:30.123Z

Pending emails from this sender will be queued and sent in the next hour window.
Rate Limit Key: rate-limit:support@company.com:2026-09-09-21
```

---

## Duplicate Notification Suppression

Once a notification is sent for a sender in a given hour, we don't send it again for that hour:

```
T=21:05:30 → Email #50 sent (rate limit exactly hit)
            → Notification sent to Slack ✓
T=21:05:35 → Email #51 attempts send (limit already at 50)
            → Detected: limit hit but already notified
            → No duplicate notification sent ✓
T=22:00:00 → New hour window
            → Counter resets
            → Notification sent again if limit hit in hour 22 ✓
```

---

## Architecture

```
Worker processes jobs:
  ┌────────────────────────────────┐
  │ 1. Get job from queue          │
  └────────────┬───────────────────┘
               │
               ↓
  ┌────────────────────────────────┐
  │ 2. checkRateLimit()            │
  │    - Get count from Redis      │
  │    - Compare with limit        │
  │    - If limit hit && not       │
  │      notified this hour:       │
  │      call notifyRateLimitHit() │
  └────────────┬───────────────────┘
               │
               ↓ (async, non-blocking)
  ┌────────────────────────────────┐
  │ 3. notifyRateLimitHit()        │
  │    - Check SLACK_WEBHOOK_URL   │
  │    - Build Slack message       │
  │    - POST to webhook (real!)   │
  │    - Add to notified set       │
  └────────────────────────────────┘
               │
               (continues job processing)
```

---

## Trade-off: Webhook vs Full OAuth

**What we built (Incoming Webhook):**
- ✅ Simple setup (one Slack API call)
- ✅ No token management
- ✅ No token refresh logic
- ✅ Real HTTP POST (satisfies hard constraint)
- ❌ Webhook is one-channel only (notifications always go to same channel)
- ❌ Can't read Slack state
- ❌ Can't do rich interactive buttons (but not needed here)

**Full OAuth would:**
- ✅ Support multiple channels
- ✅ Store user tokens in DB
- ✅ Support rich interactions
- ❌ 5x more code (app creation, token storage, refresh logic)
- ❌ Higher latency (token lookups)
- ❌ Session management complexity

**Decision:** Webhook is sufficient and defensible. The hard constraint is satisfied: **it's a real, live HTTP POST to Slack at the moment the limit is hit.** Not a log line, not a mock.

---

## Troubleshooting

### "Webhook URL not working"

**Check:**
1. URL is valid: `https://hooks.slack.com/services/...`
2. URL is not truncated or malformed
3. Test with curl: 
   ```bash
   curl -X POST YOUR_WEBHOOK_URL \
     -H 'Content-Type: application/json' \
     -d '{"text":"test"}'
   ```
   Should return: `ok`

### "Notification not appearing in Slack"

**Check:**
1. Is `SLACK_WEBHOOK_URL` set in `.env`?
   ```bash
   echo $SLACK_WEBHOOK_URL
   # Should not be empty
   ```
2. Is the webhook URL correct?
   ```bash
   curl -X POST $SLACK_WEBHOOK_URL -H 'Content-Type: application/json' -d '{"text":"test"}'
   ```
3. Check worker logs for errors:
   ```
   ✅ Slack notification sent for ...
   ```
4. Check if rate limit is actually being hit:
   ```bash
   # Schedule more emails than your limit
   MAX_EMAILS_PER_HOUR_PER_SENDER=5  # Set to low number
   # Schedule 10 emails rapidly
   ```

### "Too many notifications"

**Root cause:** Duplicate notifications in same hour window

**Fix:** Check code — should only notify once per sender per hour. If firing multiple times, verify `notifiedSenders` Set is working correctly.

---

## Verification Checklist

- [ ] Created Slack workspace and app
- [ ] Generated Incoming Webhook URL
- [ ] Added SLACK_WEBHOOK_URL to `.env`
- [ ] Tested webhook with `curl` or API endpoint
- [ ] Scheduled emails to trigger rate limit
- [ ] Saw notification appear in Slack
- [ ] Verified no duplicate notifications in same hour
- [ ] Verified graceful failure when webhook removed from .env
- [ ] Verified notification re-appears when webhook added back

---

## Files Changed (STEP 4)

- `backend/src/slack.ts` — NEW: Slack webhook notification service
- `backend/src/rate-limiter.ts` — UPDATED: Call Slack on rate limit + duplicate suppression
- `backend/src/index.ts` — UPDATED: Add /api/slack/test endpoint
- `.env.example` — UPDATED: Document SLACK_WEBHOOK_URL

---

**STEP 4 READY FOR TESTING**
