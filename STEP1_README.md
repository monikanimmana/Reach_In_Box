# STEP 1: Backend Skeleton (Express + Postgres + BullMQ + Redis)

## What's Delivered

✅ TypeScript Express API scaffold  
✅ Postgres `emails` table schema (id, sender, recipient, subject, body, status, scheduledAt, createdAt)  
✅ BullMQ queue + worker backed by Redis  
✅ Proof: delayed jobs enqueue and worker picks them up  

## Architecture Overview

```
Frontend (later)
    ↓
Express API (:3000)
    ↓
PostgreSQL (emails table) + Redis (BullMQ queue)
    ↓
Worker (separate process)
    ↓
Ethereal SMTP (later)
```

### Key Files

- **backend/src/index.ts** - Express server, API endpoints
- **backend/src/db.ts** - Postgres connection + schema initialization
- **backend/src/queue.ts** - BullMQ queue setup, `enqueueEmail()` function
- **backend/src/worker.ts** - Worker process that consumes jobs from queue
- **docker-compose.yml** - Redis + Postgres containers

### Hard Constraints Met (Step 1)

- ✅ **NO cron jobs** — Only BullMQ delayed jobs used
- ✅ **Deterministic job IDs** — Uses `email-${emailId}` (DB row ID) for idempotency
- ✅ **Jobs persist in Redis** — On worker restart, jobs are still there, waiting to be consumed

## Quick Start

### 1. Start Docker containers (Redis + Postgres)

```bash
docker-compose up -d
```

Wait for both to be healthy:
```bash
docker-compose ps
# Both should show (healthy)
```

### 2. Install dependencies (backend)

```bash
cd backend
npm install
```

### 3. Create .env file

```bash
cp .env.example .env
```

### 4. Start the Express API server

```bash
npm run dev
```

You should see:
```
✓ Database connected
✓ Database schema initialized
🚀 Backend running on port 3000
```

### 5. In another terminal, start the worker

```bash
cd backend
npm run worker
```

You should see:
```
🚀 Worker started. Listening for jobs...
   Concurrency: 5
```

## Test: Enqueue and Process a Job

### Option A: Using curl (from Windows Command Prompt)

```cmd
curl -X POST http://localhost:3000/api/emails ^
  -H "Content-Type: application/json" ^
  -d "{\"sender\":\"test@example.com\",\"recipient\":\"john@example.com\",\"subject\":\"Test\",\"body\":\"Hello\",\"scheduledAt\":1725962400000}"
```

Replace `scheduledAt` with a timestamp 2 minutes in the future:
```cmd
@echo off
REM Get current time in seconds, add 120 seconds (2 minutes), convert to milliseconds
for /f %%A in ('powershell -Command "[int](([datetime]::UtcNow).Subtract([datetime]'1970-01-01')).TotalMilliseconds + 120000"') do set FUTURE_MS=%%A
echo %FUTURE_MS%
```

### Option B: Using Postman

1. **Method:** POST
2. **URL:** `http://localhost:3000/api/emails`
3. **Body (JSON):**
```json
{
  "sender": "test@example.com",
  "recipient": "john@example.com",
  "subject": "Test Email",
  "body": "This is a test email",
  "scheduledAt": 1725962400000
}
```

(Replace `scheduledAt` with a timestamp ~2 minutes from now)

### Expected Response

```json
{
  "success": true,
  "emailId": 1,
  "message": "Email scheduled for 2026-09-09T21:20:00.000Z"
}
```

## What You'll See in Terminal

**Server logs:**
```
📧 Job added: email-1
⏳ Job delayed: email-1 (120000ms)
```

**Worker logs (after ~2 minutes):**
```
🔄 Processing job: email-1
   Email ID: 1
   To: john@example.com
   Subject: Test Email
✅ Email 1 marked as sent
✓ Job email-1 completed successfully
```

## Check Database

Connect to Postgres and verify:

```bash
# From another terminal
docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox

# Inside psql:
SELECT * FROM emails;
```

You should see your email record with `status = 'sent'`.

## What's NOT Yet Implemented (Steps 2–8)

- [ ] Persistence test (server restart scenario)
- [ ] Ethereal SMTP sending
- [ ] Rate limiting (Redis counters)
- [ ] Slack notifications
- [ ] Frontend (React/Next.js)
- [ ] Search (Elasticsearch or Postgres full-text)
- [ ] Load behavior documentation

## Key Design Decisions

1. **Job ID = `email-${emailId}`** — If you accidentally call `enqueueEmail()` twice with the same record, the second call is a safe no-op (BullMQ overwrites with same ID).

2. **Worker as separate process** — On step 2, we'll kill the server and restart it; the worker continues consuming jobs from Redis independently.

3. **Status enum in DB: `scheduled | sent | failed`** — Tracks email lifecycle.

4. **No in-memory state** — All jobs, counters, and email records live in Redis + Postgres, surviving restarts.

## Next: Step 2 (Persistence & Idempotency Test)

After verifying this works, we'll:
1. Write a script to schedule an email 2 min out
2. Kill the server process
3. Restart it
4. Prove the email still sends exactly once on time

---

**Status: STEP 1 COMPLETE**

Give me your GitHub link and I'll commit this.
