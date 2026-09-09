# STEP 3: Ethereal SMTP + Rate Limiting (Redis Counters)

## What This Delivers

✅ **Real SMTP sending** via Ethereal Email (nodemailer)  
✅ **Redis-backed rate limiting** (not in-memory, survives restarts)  
✅ **Hourly rate limits** per sender with configurable thresholds  
✅ **On-limit rescheduling** — jobs re-queued with delay to next hour  
✅ **Multiple sender support** — track limits per `sender` identity  

---

## Rate Limiting Design

### How It Works

Each sender gets an **hourly quota**. Tracking is done via Redis:

```
Redis key: "rate-limit:sender@example.com:2026-09-09-21"
           (hour 21 on that date)

Value: integer count of emails sent in that hour
TTL: 3600 seconds (1 hour)

Max per sender per hour: 50 (configurable)
```

### On Rate Limit Hit

When a sender hits their hourly quota:

1. **Do NOT drop the job** — preserve it
2. **Do NOT fail permanently** — just delay it
3. **Calculate delay to next hour** — push job into future hour window
4. **Re-queue the job** — with new `delay` parameter
5. **Preserve order** — jobs maintain FIFO within hour windows

```
Timeline (MAX_EMAILS_PER_HOUR_PER_SENDER=3):

T=0s:   Job A sent (count=1, hour=21)
T=5s:   Job B sent (count=2, hour=21)
T=10s:  Job C sent (count=3, hour=21)
T=15s:  Job D tries to send → RATE LIMIT HIT
        Re-queue with delay to hour 22 (~3585s away)
        Job D waits in queue
T=3600s: Hour 22 begins
        Job D sent (count=1, hour=22)
```

---

## Configuration

Add these to `.env`:

```bash
# Ethereal SMTP (for real email sending)
ETHEREAL_USER=your-ethereal-username@ethereal.email
ETHEREAL_PASS=your-ethereal-password

# Rate limiting (emails per hour)
MAX_EMAILS_PER_HOUR=100                    # Global (not yet used, for future)
MAX_EMAILS_PER_HOUR_PER_SENDER=50          # Per sender limit

# Worker
WORKER_CONCURRENCY=5                       # Parallel job processing
MIN_DELAY_MS=100                           # Delay between individual sends
```

### Getting Ethereal Credentials

1. Visit https://ethereal.email
2. Click "Create Ethereal Account"
3. Copy the generated email and password
4. Add to `.env`:
   ```
   ETHEREAL_USER=first.last@ethereal.email
   ETHEREAL_PASS=your-generated-password
   ```
5. Sent emails preview at: https://ethereal.email/messages

---

## API Endpoints

### Schedule Email (with rate limit status)

```bash
POST /api/emails

{
  "sender": "support@company.com",
  "recipient": "customer@example.com",
  "subject": "Hello",
  "body": "This is an email",
  "scheduledAt": 1725962400000
}

Response:
{
  "success": true,
  "emailId": 1,
  "message": "Email scheduled for 2026-09-09T21:20:00.000Z",
  "rateLimit": {
    "hourKey": "rate-limit:support@company.com:2026-09-09-21",
    "currentCount": 2,
    "limit": 50,
    "remaining": 48,
    "percentUsed": 4,
    "resetAt": "2026-09-09T22:00:00.000Z"
  }
}
```

### Check Rate Limit Status

```bash
GET /api/rate-limit/:sender

GET /api/rate-limit/support@company.com

Response:
{
  "success": true,
  "rateLimit": {
    "hourKey": "rate-limit:support@company.com:2026-09-09-21",
    "currentCount": 2,
    "limit": 50,
    "remaining": 48,
    "percentUsed": 4,
    "resetAt": "2026-09-09T22:00:00.000Z"
  }
}
```

---

## Testing Rate Limits

### Manual Test: Rapid Fire Emails

Schedule multiple emails rapidly to same sender:

```bash
# Terminal: Rapid POST requests
for i in {1..55}; do
  curl -X POST http://localhost:3000/api/emails \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"test@example.com\",\"recipient\":\"user@example.com\",\"subject\":\"Test $i\",\"body\":\"Body $i\",\"scheduledAt\":$(date +%s%3N)}" &
done
wait
```

**Expected behavior:**

- First 50 emails → rate limit increments from 0 to 50
- Email #51 → attempts send, sees limit hit
- Email #51 → re-queued with ~60 min delay
- Job logs: `⏳ Rate limit hit... Re-queueing with 3600000ms delay`

### Check Database

```bash
docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox

SELECT sender, COUNT(*) as count, 
       MIN(status) as statuses 
FROM emails 
GROUP BY sender;
```

Expected:
- 50 emails with `status='sent'`
- 5 emails with `status='scheduled'` (waiting for next hour)

### Check Redis Counters

```bash
docker exec -it reachinbox-redis redis-cli

KEYS "rate-limit:*"
GET rate-limit:test@example.com:2026-09-09-21
TTL rate-limit:test@example.com:2026-09-09-21  # Should be ~3500-3600 seconds
```

---

## Hard Constraints Check

✅ **Rate limits Redis-backed** — Not in-memory  
✅ **Survives restarts** — Counters persist in Redis with TTL  
✅ **Multiple instances** — Each worker checks same Redis counter (atomic INCR)  
✅ **No cron** — Only BullMQ `delay` parameter, evaluated at job creation  
✅ **Idempotency** — Same email never re-sent if partially processed  

---

## Architecture: Rate Limiting Flow

```
Job ready to send:
┌─────────────────────────────────────────┐
│ 1. Worker picks up job                  │
│    emailId, sender, recipient, ...      │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│ 2. Check rate limit: Redis.GET           │
│    key="rate-limit:{sender}:{hour}"     │
│    Get current count                    │
└────────────┬────────────────────────────┘
             │
      ┌──────┴──────┐
      │             │
   Count < Limit  Count >= Limit
      │             │
      ↓             ↓
┌──────────┐  ┌─────────────────────┐
│ 3a.      │  │ 3b.                 │
│ Send     │  │ Calculate delay to  │
│ Email    │  │ next hour           │
│ via SMTP │  │                     │
└─────┬────┘  │ Call enqueueEmail() │
      │       │ with new delay      │
      │       │                     │
      ↓       │ Throw error         │
┌──────────┐  │ (BullMQ retries)    │
│ 4a.      │  └────────┬────────────┘
│ Update   │           │
│ DB: sent │           ↓
│          │  ┌──────────────────┐
│ Redis.   │  │ Job re-queued    │
│ INCR     │  │ for next hour    │
│ counter  │  │                  │
└──────────┘  └──────────────────┘
```

---

## Worker Log Examples

### Successful Send

```
🔄 Processing job: email-1
   Email ID: 1
   From: support@company.com
   To: customer@example.com
   Subject: Your Account Update
✅ Email 1 sent
   Message ID: <abc123@ethereal>
   Rate limit: 3/50
   Preview: https://ethereal.email/message/abc123
✓ Job email-1 completed successfully
```

### Rate Limit Hit & Requeue

```
🔄 Processing job: email-51
   Email ID: 51
   From: support@company.com
   To: customer51@example.com
   Subject: Your Account Update
⏳ Rate limit hit for support@company.com
   Current: 50/50
   Resetting at: 2026-09-09T22:00:00.000Z
   Re-queueing with 3585432ms delay
✓ Job email-51 completed with delay rescheduling
```

---

## Multiple Sender Scenario

Each sender has independent hourly quota:

```
Sender A (support@company.com):    2/50 sent
Sender B (noreply@company.com):   18/50 sent
Sender C (alerts@company.com):     1/50 sent
```

Limits tracked separately:
```
Redis:
  rate-limit:support@company.com:2026-09-09-21  → "2"
  rate-limit:noreply@company.com:2026-09-09-21  → "18"
  rate-limit:alerts@company.com:2026-09-09-21   → "1"
```

Each sender can independently hit their limit:

```
Sender A hits 50 → re-queued to next hour
Sender B continues sending (still under 50)
Sender C continues sending (still under 50)
```

---

## Behavior Under Load (1000+ emails)

**Scenario:** 1000 emails scheduled for roughly the same time, all from same sender, with `MAX_EMAILS_PER_HOUR_PER_SENDER=50`

**Timeline:**

```
Hour 21 (0-3600s):
  Jobs 1-50 → sent immediately (rate limit = 50/50)
  Jobs 51-100 → attempt send
    Each one: detects limit, re-queues to hour 22
    Each one: delay = ~3600s
    All stay in Redis queue ordered by job ID

Hour 22 (3600-7200s):
  Hour 22 window opens, TTL expires, new counter = 0/50
  Jobs 51-100 all hit timeout simultaneously
  Worker (concurrency=5) processes in order:
    51-55 send (rate limit = 5/50)
    56-60 send (rate limit = 10/50)
    61-65 send (rate limit = 15/50)
    ... continues until all 50 in hour 22 sent
  Jobs 101-150 again hit rate limit → re-queue to hour 23
  Remaining jobs are waiting

Hour 23 onwards:
  Process continues in order, 50 per hour
  1000 emails complete in ~20 hours total
```

**Design guarantees:**
- No duplicates (job IDs deterministic)
- Order preserved within limits (FIFO in Redis queue)
- No data loss (persisted in Redis + Postgres)
- Fair distribution (first-come-first-serve)

---

## Troubleshooting

### "Rate limit not working / emails sent beyond limit"

**Check:**
1. Redis is running: `docker-compose ps`
2. REDIS_URL is correct in `.env`
3. Worker is using rate limiter: Check worker logs for `checkRateLimit` calls
4. Ethereal credentials valid: ETHEREAL_USER and ETHEREAL_PASS set

### "Emails re-queue but never send in next hour"

**Check:**
1. Worker is still running (doesn't crash after re-queue)
2. Next hour window is reached (wait until hour boundary)
3. Redis TTL is set correctly: `TTL rate-limit:...` should show ~3600 seconds
4. No errors in worker logs

### "Rate limit counter stuck at high number"

**Diagnosis:** Redis key TTL not set or renewed

**Fix:**
1. Manually expire the key:
   ```bash
   docker exec -it reachinbox-redis redis-cli DEL rate-limit:sender@example.com:2026-09-09-21
   ```
2. Check code: `incrementRateLimit()` should call `redis.expire()` on first increment

---

## Next: STEP 4 (Slack Notifications on Rate Limit Hit)

After verifying rate limits work, we'll add:
1. Real Slack Webhook URL in `.env`
2. Trigger Slack notification the instant a sender hits their hourly limit
3. Graceful failure if Slack not connected

---

## Files Changed (STEP 3)

- `backend/src/smtp.ts` — NEW: Ethereal SMTP integration
- `backend/src/rate-limiter.ts` — NEW: Redis counter logic
- `backend/src/worker.ts` — UPDATED: Rate limit check + re-queue on hit
- `backend/src/index.ts` — UPDATED: SMTP init + rate limit API endpoint
- `backend/package.json` — Already has dependencies

---

**STEP 3 READY FOR TESTING**
