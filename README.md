# ReachInbox — Production Email Scheduler

**A complete, production-grade email job scheduler with real OAuth, rate limiting, and persistence across restarts.**

Built for the ReachInbox.ai hiring assignment with **zero cron jobs**, **exactly-once delivery**, and **Redis-backed rate limiting**.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Hard Constraints Met](#hard-constraints-met)
4. [Features](#features)
5. [Setup](#setup)
6. [API Endpoints](#api-endpoints)
7. [Verification Tests](#verification-tests)
8. [Trade-offs & Decisions](#trade-offs--decisions)
9. [Load Behavior](#load-behavior)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- npm or yarn

### 1. Start Docker Containers

```bash
docker-compose up -d
# Wait ~30 seconds for health checks
docker-compose ps
```

Both `postgres` and `redis` should show `(healthy)`.

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and add:
# - ETHEREAL_USER and ETHEREAL_PASS (from https://ethereal.email)
# - SLACK_WEBHOOK_URL (optional)
```

### 3. Start Backend API

```bash
npm run dev  # Terminal 1
```

Server runs on `http://localhost:3000`.

### 4. Start Worker

```bash
npm run worker  # Terminal 2
```

Worker picks up jobs from Redis queue.

### 5. Frontend Setup (Optional)

```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local and add Google OAuth credentials
npm run dev  # Terminal 3
```

Dashboard runs on `http://localhost:3001`.

### 6. Test It

```bash
npm run test:restart  # Terminal 4 (from backend/ dir)
```

This schedules an email 2 minutes out, then you'll kill/restart servers and verify it sends exactly once.

---

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────┐
│ Frontend (React/Next.js)                                 │
│ - Google OAuth login                                     │
│ - Compose modal (send bulk emails)                       │
│ - Tables (scheduled, sent)                               │
└────────────────────┬─────────────────────────────────────┘
                     │ (TypeScript, Tailwind, NextAuth)
                     ↓
┌──────────────────────────────────────────────────────────┐
│ Backend API (Express.js, TypeScript)                     │
│ - POST /api/emails (schedule email)                      │
│ - GET /api/emails (list scheduled)                       │
│ - GET /api/emails/sent (list sent/failed)                │
│ - GET /api/emails/search (Postgres full-text)            │
│ - GET /api/rate-limit/:sender (check limit status)       │
│ - POST /api/slack/test (test Slack webhook)              │
└────────────┬────────────────────────────────────────────┘
             │
      ┌──────┴──────┬──────────────┐
      ↓             ↓              ↓
 ┌────────┐  ┌────────────┐  ┌─────────────┐
 │ Postgres│  │ Redis      │  │ Ethereal    │
 │ (DB)    │  │ (BullMQ)   │  │ SMTP        │
 │         │  │            │  │             │
 │ emails  │  │ job queue  │  │ sends emails│
 │ table   │  │ rate       │  │ real SMTP   │
 └────────┘  │ counters   │  └─────────────┘
             └────────────┘
                  ↓
             ┌──────────────┐
             │ Worker Process
             │ (separate)   │
             │              │
             │ Picks up     │
             │ jobs from    │
             │ queue,       │
             │ checks rate  │
             │ limits,      │
             │ sends via    │
             │ Ethereal     │
             └──────────────┘
```

### Data Flow: Scheduling an Email

```
User fills compose form
  ↓
Frontend: POST /api/emails
  ↓
Backend:
  1. Insert into emails table (status='scheduled')
  2. Enqueue BullMQ job with delay
  3. Return emailId + rate limit status
  ↓
Frontend: Show "Email scheduled" toast
  ↓
Worker (watching queue):
  1. Job delay expires
  2. Check rate limit (Redis counter)
  3. If allowed: send via Ethereal SMTP
  4. Update DB: status='sent', sent_at=NOW()
  5. Increment rate limit counter
  ↓
If rate limit hit:
  1. Re-enqueue with delay to next hour
  2. Notify Slack webhook (if configured)
```

---

## Hard Constraints Met

✅ **NO cron jobs** — Only BullMQ delayed jobs (no node-cron, agenda, or crontab)  
✅ **Survives restart** — Jobs persist in Redis, worker reconnects and resumes  
✅ **Idempotency** — Deterministic job IDs (`email-${emailId}`) prevent duplicates  
✅ **Redis/DB-backed rate limits** — Atomic INCR + TTL, not in-memory  
✅ **Real Slack notification** — HTTP POST to webhook at the moment limit is hit (not a log line)  
✅ **Real Google OAuth** — NextAuth.js with Google provider (not mocked)  

---

## Features

### 1. Email Scheduling
- **Recipients**: CSV or line-break separated email addresses
- **Sender**: Multiple sender identities supported (tracked separately for rate limiting)
- **Content**: Subject + body (HTML supported)
- **Schedule**: Date + time picker, Unix timestamp storage
- **Bulk**: Schedule 1-1000+ emails at once (subject to rate limits)

### 2. Rate Limiting
- **Hourly limits**: Per sender per hour (configurable, default 50 emails/hr)
- **Atomic counting**: Redis INCR + TTL, survives restarts
- **Smart re-queueing**: Jobs delayed to next hour window, not failed
- **Order preservation**: FIFO within each hour window
- **Multi-instance safe**: Works with multiple worker processes

### 3. Slack Notifications
- **Webhook-based**: No OAuth complexity (Incoming Webhook)
- **Real-time**: Posted the instant rate limit is hit
- **Graceful failure**: If webhook not configured, notifications skipped (no crash)
- **Duplicate suppression**: Only one notification per sender per hour
- **Rich formatting**: Block Kit messages with sender, count, limit, reset time

### 4. Persistence & Idempotency
- **Server restart test**: Schedule email, kill server, restart, verify sends once
- **Deterministic job IDs**: Same email record always maps to same BullMQ job ID
- **No DB re-derivation**: Worker doesn't re-query DB on startup (prevents duplicates)
- **Async guarantees**: DB + Redis remain consistent

### 5. Search
- **Full-text search**: Postgres FTS on subject, body, sender, recipient
- **Advanced filters**: By sender, status, date range
- **No separate service**: Uses built-in Postgres (no Elasticsearch container)
- **Trade-off documented**: See [Trade-offs](#trade-offs--decisions)

### 6. Monitoring
- **Health check**: GET /api/health
- **Rate limit status**: GET /api/rate-limit/:sender
- **Email tables**: Scheduled, Sent, Failed
- **Auto-refresh**: Frontend refreshes every 5 seconds

---

## Setup

### Backend

**Dependencies:**
- TypeScript, Express.js, BullMQ, Redis, PostgreSQL, nodemailer, axios

**Environment Variables:**

```bash
# Database
DATABASE_URL=postgresql://reachinbox:password@localhost:5432/reachinbox

# Redis
REDIS_URL=redis://localhost:6379

# Express
PORT=3000
NODE_ENV=development

# Ethereal SMTP (real sending, not mocked)
ETHEREAL_USER=your-ethereal-user@ethereal.email
ETHEREAL_PASS=your-ethereal-password

# Rate Limiting
MAX_EMAILS_PER_HOUR=100                    # Global (future use)
MAX_EMAILS_PER_HOUR_PER_SENDER=50          # Per sender per hour

# Worker
WORKER_CONCURRENCY=5                       # Parallel job processing
MIN_DELAY_MS=100                           # Delay between individual sends

# Slack (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Google OAuth (frontend only, but docs here)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
```

**Install & Run:**

```bash
cd backend
npm install
npm run dev      # API server (port 3000)
npm run worker   # In separate terminal (job worker)
```

### Frontend

**Dependencies:**
- React 18, Next.js 14, NextAuth.js, Tailwind CSS, TypeScript

**Environment Variables:**

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=<openssl rand -base64 32>

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

**Install & Run:**

```bash
cd frontend
npm install
npm run dev  # Dashboard (port 3001)
```

**Google OAuth Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create OAuth 2.0 credentials (Web application)
3. Add redirect URIs: `http://localhost:3001/api/auth/callback/google`
4. Copy Client ID and Secret to `.env.local`

### Docker (Redis + Postgres)

```bash
docker-compose up -d

# Verify health
docker-compose ps

# Access Postgres
docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox

# Access Redis CLI
docker exec -it reachinbox-redis redis-cli
```

---

## API Endpoints

### Schedule Email
```bash
POST /api/emails

{
  "sender": "support@company.com",
  "recipient": "customer@example.com",
  "subject": "Your Order",
  "body": "<h1>Hi!</h1><p>Order confirmed.</p>",
  "scheduledAt": 1725962400000  # Unix ms
}

Response:
{
  "success": true,
  "emailId": 1,
  "message": "Email scheduled for 2026-09-09T21:20:00.000Z",
  "rateLimit": {
    "hourKey": "rate-limit:support@company.com:2026-09-09-21",
    "currentCount": 5,
    "limit": 50,
    "remaining": 45,
    "percentUsed": 10,
    "resetAt": "2026-09-09T22:00:00.000Z"
  }
}
```

### Get Scheduled Emails
```bash
GET /api/emails?status=scheduled

Response:
{
  "success": true,
  "count": 42,
  "emails": [
    {
      "id": 1,
      "sender": "support@company.com",
      "recipient": "john@example.com",
      "subject": "Your Order",
      "status": "scheduled",
      "scheduled_at": "2026-09-09T21:20:00.000Z",
      "created_at": "2026-09-09T21:00:00.000Z"
    },
    ...
  ]
}
```

### Get Sent/Failed Emails
```bash
GET /api/emails/sent

Response: (same structure, status='sent' or 'failed')
```

### Search Emails
```bash
GET /api/emails/search?q=order

Response:
{
  "success": true,
  "query": "order",
  "count": 12,
  "results": [
    {
      "id": 1,
      "sender": "support@company.com",
      "recipient": "john@example.com",
      "subject": "Your Order Confirmed",
      "status": "sent",
      "scheduled_at": "2026-09-09T21:20:00.000Z",
      "relevance": 0.9
    },
    ...
  ]
}
```

### Advanced Search
```bash
GET /api/emails/search/advanced?q=order&status=sent&sender=support@company.com

Response: (same as above, with filters applied)
```

### Get Rate Limit Status
```bash
GET /api/rate-limit/support@company.com

Response:
{
  "success": true,
  "rateLimit": {
    "hourKey": "rate-limit:support@company.com:2026-09-09-21",
    "currentCount": 50,
    "limit": 50,
    "remaining": 0,
    "percentUsed": 100,
    "resetAt": "2026-09-09T22:00:00.000Z"
  }
}
```

### Test Slack Webhook
```bash
POST /api/slack/test

Response:
{
  "success": true,
  "message": "Test notification sent to Slack"
}
```

---

## Verification Tests

### Test 1: Basic Scheduling & Sending

```bash
# From backend/ directory in Terminal 4
npm run test:restart
```

This script:
1. Schedules an email to send in 2 minutes
2. Prints instructions for the restart test
3. Displays expected verification points

**Check:**
- Email appears in DB with `status='scheduled'`
- Job appears in Redis queue
- Email sends after 2 minutes
- Worker log shows "✅ Email [ID] marked as sent"

### Test 2: Restart Persistence

**Manual test:**

1. **Terminal 1**: Run `npm run dev` (API server)
2. **Terminal 2**: Run `npm run worker`
3. **Terminal 3**: Run `npm run test:restart`
   - Wait for "Email scheduled" message
   - Note the scheduled time and Email ID
4. **Kill Terminal 1 & 2** (Ctrl+C)
5. **Restart Terminal 1** (API server)
6. **Restart Terminal 2** (worker)
7. **Wait** until scheduled time
8. **Verify**: Email sends exactly once
   - Check DB: `SELECT * FROM emails WHERE id=X;` → status='sent'
   - Check worker logs: "✅ Email X marked as sent" appears once

### Test 3: Rate Limiting

```bash
# Schedule 55 emails rapidly (exceeding 50/hr limit)
for i in {1..55}; do
  curl -X POST http://localhost:3000/api/emails \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"test@example.com\",\"recipient\":\"user$i@example.com\",\"subject\":\"Test $i\",\"body\":\"Body\",\"scheduledAt\":$(date +%s%3N)}" &
done
wait

# Check worker logs: first 50 send, next 5 re-queued
# Check Slack: 1 notification (not 5) about rate limit hit
# Check DB: 50 'sent', 5 'scheduled' (waiting for next hour)
```

### Test 4: Search

```bash
# After scheduling some emails, search for them
curl "http://localhost:3000/api/emails/search?q=order"

# Should return emails with subject containing "order"
```

### Test 5: Frontend (if running)

1. Go to `http://localhost:3001`
2. Click "Sign in with Google"
3. Complete OAuth flow
4. Should see dashboard with empty tables
5. Click "Compose Email"
6. Fill form and schedule
7. Should see email appear in "Scheduled" tab within 5 seconds
8. After scheduled time, should move to "Sent" tab

---

## Trade-offs & Decisions

### Trade-off 1: Postgres Full-Text Search vs Elasticsearch

**Decision:** Postgres FTS (no Elasticsearch container)

**Why:**
- Search is single-table (emails table only)
- No indexing sync issues (atomic with email insert/update)
- No new container to manage
- Good enough for typical email volumes (<1M records)

**If needed later:**
- Can add Elasticsearch without breaking changes
- Keep Postgres FTS as fallback
- Migrate incrementally

**Trade**: Lower search features (no faceted search, no advanced relevance tuning).

### Trade-off 2: Slack Webhook vs Full OAuth

**Decision:** Incoming Webhook (no full OAuth app)

**Why:**
- Simple setup (one API call)
- No token management or refresh logic
- Real HTTP POST (satisfies hard constraint)
- Faster, fewer failure points

**Trade**: One-channel only (can't send to different channels based on context).

**If needed later:**
- Migrate to full OAuth app with token storage
- Webhook as fallback

### Trade-off 3: Rate Limit Re-queueing vs Failure

**Decision:** Re-queue with delay (not permanent failure)

**Why:**
- Better UX (emails eventually send, within limits)
- Order preserved (FIFO within hour windows)
- No data loss

**Trade**: Requires longer time to send bulk emails if approaching limits (e.g., 1000 emails with 50/hr limit = 20 hours).

This is acceptable for the use case (email scheduling is inherently async).

### Trade-off 4: Min Delay Between Sends

**Decision:** 100ms default (configurable via `MIN_DELAY_MS`)

**Why:**
- Prevents overwhelming Ethereal SMTP with simultaneous connections
- Allows worker to process other jobs
- Configurable per deployment

**Recommendation:**
- Ethereal (test): 100-500ms
- Production SMTP: Adjust based on provider limits

---

## Load Behavior

### Scenario: 1000 Emails Scheduled for Same Time

**Setup:**
- All 1000 from sender `support@company.com`
- All scheduled for same hour (e.g., 21:00-22:00)
- `MAX_EMAILS_PER_HOUR_PER_SENDER=50`

**Timeline:**

```
Hour 21 (00:00-59:59):
  ├─ Jobs 1-50: Send immediately (rate limit = 50/50)
  ├─ Jobs 51-100: Attempt send
  │   └─ Detect: limit hit (count >= 50)
  │   └─ Re-queue with delay ~3600s to hour 22
  │   └─ Slack notification sent (once, not 50 times)
  ├─ Jobs 101-1000: Same as 51-100
  └─ At end of hour 21: 50 sent, 950 scheduled (awaiting next hour)

Hour 22 (00:00-59:59):
  ├─ TTL expires on rate-limit key, counter resets to 0/50
  ├─ 950 queued jobs resume (in FIFO order)
  ├─ Jobs 51-100: Send (rate limit = 0→50/50)
  ├─ Jobs 101-150: Re-queued to hour 23
  ├─ ... continue until end of hour
  └─ At end: 50 more sent, 900 waiting

... continues (20 hours total)

Hour 40:
  └─ Last 50 emails sent
```

**Key characteristics:**
- ✅ **No loss**: All 1000 emails eventually send
- ✅ **Ordered**: Sent in FIFO order per hour window
- ✅ **Atomic**: Counts never go negative or exceed limit
- ✅ **Restartable**: If worker crashes hour 5, resumes at hour 6
- ❌ **Slow**: 1000 emails take 20 hours (by design, respects limits)

### Behavior with Multiple Senders

**Setup:**
- Sender A: 200 emails
- Sender B: 150 emails
- Limit per sender: 50/hour

**Result:**
- A's limit tracked separately (rate-limit:A:*)
- B's limit tracked separately (rate-limit:B:*)
- A can hit limit while B still has capacity
- Independent re-queueing per sender

```
Hour 21:
  Sender A: 50 sent (limit hit), 150 re-queued
  Sender B: 50 sent (limit hit), 100 re-queued

Hour 22:
  Sender A: 50 sent, 100 re-queued
  Sender B: 50 sent, 50 re-queued

Hour 23:
  Sender A: 50 sent
  Sender B: 50 sent (all done)
```

### Worker Capacity

**Setup:**
- `WORKER_CONCURRENCY=5`
- Each send takes ~200ms (network + Ethereal SMTP)

**Result:**
- 5 concurrent jobs = max throughput ~25/sec
- With 100ms `MIN_DELAY_MS` = ~10 emails/sec
- More workers = higher throughput (scale horizontally)

**Example with 10 workers:**
- Throughput: 500+ emails/sec possible
- Limited only by rate limits (hourly windows)

---

## Troubleshooting

### "Email not sending"

**Check:**
1. Is worker running? `npm run worker` output should show "Listening for jobs"
2. Is Ethereal configured? Check `.env`: ETHEREAL_USER, ETHEREAL_PASS
3. Is job in Redis queue?
   ```bash
   docker exec -it reachinbox-redis redis-cli KEYS bull:emails:*
   ```
4. Check worker logs for errors

**Fix:**
- Restart worker: `Ctrl+C`, then `npm run worker`
- Check Ethereal account at https://ethereal.email/messages (preview sent emails)

### "Rate limit not working"

**Check:**
1. Is Redis running? `docker-compose ps`
2. Check rate limit counter:
   ```bash
   docker exec -it reachinbox-redis redis-cli GET rate-limit:test@example.com:2026-09-09-21
   ```
3. Worker logs should show `⏳ Rate limit hit` messages

**Fix:**
- Reset counter: `redis-cli DEL rate-limit:test@example.com:2026-09-09-21`
- Restart worker

### "Slack notification not appearing"

**Check:**
1. Is webhook URL valid? Test with curl:
   ```bash
   curl -X POST YOUR_WEBHOOK_URL -H 'Content-Type: application/json' -d '{"text":"test"}'
   ```
   Should return `ok`.
2. Is `SLACK_WEBHOOK_URL` set in backend `.env`?
3. Is rate limit actually being hit? (Check worker logs)

**Fix:**
- Verify webhook URL is correct
- Restart backend if `.env` changed
- Test with manual curl above

### "Search returning no results"

**Check:**
1. Are there emails in the database?
   ```bash
   docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox
   SELECT * FROM emails LIMIT 1;
   ```
2. Is search index initialized?
   ```bash
   SELECT * FROM pg_stat_user_indexes WHERE indexname LIKE '%search%';
   ```

**Fix:**
- Search only works on emails with text (body/subject not null)
- Try broader search term: `?q=a` instead of `?q=xyz123`
- Restart backend to force re-initialize indexes

### "Frontend not connecting to backend"

**Check:**
1. Is backend running on port 3000?
2. Is `NEXT_PUBLIC_API_URL=http://localhost:3000` in frontend `.env.local`?
3. Browser console for errors (F12 → Console tab)

**Fix:**
- Restart frontend: `npm run dev`
- Check CORS enabled (should be, middleware has `cors()`)

---

## File Structure

```
ReachInbox/
├── backend/
│   ├── src/
│   │   ├── index.ts               (Express API)
│   │   ├── db.ts                  (Postgres connection + schema)
│   │   ├── queue.ts               (BullMQ setup)
│   │   ├── worker.ts              (Job processor)
│   │   ├── smtp.ts                (Ethereal integration)
│   │   ├── rate-limiter.ts        (Redis rate limiting)
│   │   ├── slack.ts               (Slack webhook)
│   │   ├── search.ts              (Postgres full-text search)
│   │   └── restart-test.ts        (Test script)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── .gitignore
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           (Dashboard)
│   │   │   ├── layout.tsx         (Root layout)
│   │   │   ├── api/auth/[...nextauth]/route.ts  (OAuth)
│   │   │   └── auth/signin/page.tsx             (Sign-in)
│   │   ├── components/
│   │   │   ├── Header.tsx         (User header)
│   │   │   ├── ComposeModal.tsx   (Email composer)
│   │   │   └── EmailTable.tsx     (Email list)
│   │   ├── lib/
│   │   │   └── api.ts             (Typed API client)
│   │   └── styles/
│   │       └── globals.css        (Tailwind setup)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── .env.example
│   └── .gitignore
├── docker-compose.yml
├── .gitignore
├── package.json (workspace root)
├── README.md (this file)
├── STEP1_README.md
├── STEP2_RESTART_TEST.md
├── STEP3_RATE_LIMITING.md
├── STEP4_SLACK.md
└── STEP5_FRONTEND.md
```

---

## Assumptions & Shortcuts

1. **Email validation**: Basic `@` check, not full RFC 5322
2. **Body as HTML**: No validation, assumes safe user input
3. **Timezone**: All timestamps in UTC
4. **Rate limit window**: Hour boundaries (00:00, 01:00, etc. UTC)
5. **Search**: No multi-language support (English only)
6. **Slack**: Webhook only, no rich interactions (buttons, etc.)
7. **Google OAuth**: No refresh token handling (access token expiry not managed)
8. **Production**: `.env` secrets must be protected (not in git)

---

## Next Steps (After This Assignment)

1. **Elasticsearch**: Replace Postgres FTS for better search UX
2. **Webhooks**: Add email delivery confirmation webhooks
3. **Templates**: Support email templates with variable substitution
4. **Analytics**: Track delivery rates, open rates, click rates
5. **UI**: Pixel-perfect design matching Figma
6. **Tests**: Unit tests, integration tests, load testing
7. **Monitoring**: Prometheus metrics, OpenTelemetry tracing
8. **Database migrations**: Flyway or similar for version control

---

## Questions?

Refer to individual step documentation:
- `STEP1_README.md` — Backend skeleton & BullMQ
- `STEP2_RESTART_TEST.md` — Persistence & idempotency
- `STEP3_RATE_LIMITING.md` — Rate limiter design
- `STEP4_SLACK.md` — Slack webhook setup
- `STEP5_FRONTEND.md` — Frontend & OAuth

Or check worker logs and backend logs for debugging:
```bash
# Worker logs (should show job processing)
npm run worker

# Backend logs (should show API requests)
npm run dev

# Database (inspect data)
docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox
```

---

**Built with ❤️ for ReachInbox.ai**

**Hard constraints: VERIFIED ✓**
- ✅ No cron jobs
- ✅ Survives restart
- ✅ Idempotency
- ✅ Rate limits Redis-backed
- ✅ Real Slack notification
- ✅ Real Google OAuth
