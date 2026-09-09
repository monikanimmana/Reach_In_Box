# STEP 2: Persistence Across Restarts + Idempotency

## What This Proves

This is the **core technical bar** of the assignment. We demonstrate:

✅ **Email survives server restart** — BullMQ jobs persist in Redis  
✅ **Worker reconnects safely** — On restart, resumes pending jobs  
✅ **No duplicates** — Deterministic job IDs (`email-${emailId}`) ensure safe no-op re-enqueues  
✅ **Exactly-once delivery** — Email fires once, never twice  
✅ **Zero cron involvement** — Pure Redis-backed scheduling  

---

## Prerequisites

Verify from STEP 1:

```bash
# Docker containers running
docker-compose ps
# Both postgres and redis should show (healthy)

# Backend installed
cd backend
npm install
```

---

## Run the Restart Test

### Terminal 1: Start the API server

```bash
cd backend
npm run dev
```

You should see:
```
✓ Database connected
✓ Database schema initialized
🚀 Backend running on port 3000
```

### Terminal 2: Start the worker

```bash
cd backend
npm run worker
```

You should see:
```
🚀 Worker started. Listening for jobs...
   Concurrency: 5
```

### Terminal 3: Schedule the test email

```bash
cd backend
npm run test:restart
```

You will see:
```
🧪 RESTART TEST - Persistence & Idempotency Proof

⏱️  Scheduling email to send in 2 minutes...

📧 Email details:
   From: test@reachinbox.ai
   To: restart-test@example.com
   Subject: Restart Test - 2026-09-09T21:05:30.123Z
   Scheduled for: 2026-09-09T21:07:30.123Z
   Timestamp (ms): 1725962850123

✅ Email scheduled successfully!

📝 Email ID: 1

⚡ TEST INSTRUCTIONS:

1. WAIT ~10 seconds (let job propagate to Redis)
2. KILL the API server (Ctrl+C on "npm run dev" terminal)
3. KILL the worker process (Ctrl+C on "npm run worker" terminal)
4. RESTART the API server (npm run dev)
5. RESTART the worker (npm run worker)
6. WAIT for ~2 minutes from the scheduled time
7. CHECK: Email should be sent EXACTLY ONCE
```

---

## Execution Steps

### Step 1: Wait 10 seconds
Let the job propagate through the system.

**What's happening in the background:**
```
API server: Saves email to DB with status="scheduled"
API server: Calls enqueueEmail() → Job added to Redis queue with ID="email-1"
Worker: Sees job in queue, calculates delay (~120 seconds)
Worker: Job enters "delayed" state in Redis (waiting for trigger time)
```

### Step 2: Kill the API server
```bash
# In Terminal 1 (where "npm run dev" is running)
Ctrl+C
```

You'll see:
```
^C
```

**What happens:**
- Express server shuts down
- HTTP API becomes unavailable
- **But:** Job is still in Redis with full delay state intact

### Step 3: Kill the worker
```bash
# In Terminal 2 (where "npm run worker" is running)
Ctrl+C
```

You'll see:
```
^C
⛔ Received SIGINT, shutting down worker...
```

**What happens:**
- Worker shuts down gracefully
- No new jobs are processed
- **But:** All pending jobs remain in Redis, unchanged

### Step 4: Check Redis directly (optional)
Verify the job is still there:

```bash
# In a new terminal
docker exec -it reachinbox-redis redis-cli

# Inside redis-cli:
KEYS bull:emails:* 
# You should see keys like: bull:emails:email-1:...
HGETALL bull:emails:email-1
# Should show the job data with its delay state
exit
```

### Step 5: Restart the API server
```bash
# In Terminal 1
cd backend
npm run dev
```

You'll see:
```
✓ Database connected
✓ Database schema initialized
🚀 Backend running on port 3000
```

**What happens:**
- Express reconnects to Redis
- Postgres reconnects
- **But:** No jobs are re-derived from DB or re-enqueued (CRITICAL — this is idempotency)

### Step 6: Restart the worker
```bash
# In Terminal 2
cd backend
npm run worker
```

You'll see:
```
🚀 Worker started. Listening for jobs...
   Concurrency: 5
```

**What happens:**
- Worker reconnects to Redis
- Scans the queue for pending/active jobs
- Finds `email-1` still waiting for its trigger time
- Resumes processing as if it was never interrupted

### Step 7: Wait for the scheduled time

From the original `npm run test:restart` output, note the scheduled time:
```
Scheduled for: 2026-09-09T21:07:30.123Z
```

Wait until that time arrives (~2 minutes from the original schedule).

**What you'll see in worker logs:**
```
🔄 Processing job: email-1
   Email ID: 1
   To: restart-test@example.com
   Subject: Restart Test - 2026-09-09T21:05:30.123Z
✅ Email 1 marked as sent
✓ Job email-1 completed successfully
```

### Step 8: Verify in Database

Connect to Postgres and check:

```bash
# In a new terminal
docker exec -it reachinbox-postgres psql -U reachinbox -d reachinbox

# Inside psql:
SELECT id, sender, recipient, subject, status, scheduled_at, sent_at, created_at FROM emails;
```

You should see:
```
 id |        sender        |            recipient            |        subject         | status |        scheduled_at        |        sent_at         |        created_at      
----+----------------------+---------------------------------+------------------------+--------+----------------------------+------------------------+----------------------------
  1 | test@reachinbox.ai   | restart-test@example.com        | Restart Test - 2026... | sent   | 2026-09-09 21:07:30.123    | 2026-09-09 21:07:30.5  | 2026-09-09 21:05:30.123
(1 row)
```

**Key observations:**
- ✅ `status = 'sent'` — Email was sent (not stuck in "scheduled")
- ✅ `sent_at` is close to `scheduled_at` (within a second)
- ✅ Only ONE row with this test ID — **no duplicates**

---

## Verify Idempotency (Optional Extra Test)

Run the restart test script twice with the same database:

```bash
npm run test:restart   # First time → Email ID: 1
# Wait a few seconds
npm run test:restart   # Second time → Email ID: 2 (new row in DB)
```

**What happens:**
- First call: Creates new email record (ID=1), enqueues job with ID="email-1"
- Second call: Creates new email record (ID=2), enqueues job with ID="email-2"
- **Each gets its own job ID, so they're independent**

Now prove same-email idempotency:

```bash
# Directly in code (advanced test):
# Manually call enqueueEmail() twice with the same emailId

const emailId = 1;
await enqueueEmail(1, 'test@example.com', ..., scheduledAt);
await enqueueEmail(1, 'test@example.com', ..., scheduledAt);  // Same ID
// Second call overwrites first (safe no-op in BullMQ)
```

The key is: **Job ID is deterministic**, so re-adding is idempotent.

---

## Hard Constraints Check

✅ **No cron jobs** — Only BullMQ delayed jobs, no node-cron or agenda  
✅ **Survives restart** — Redis persists jobs, worker reconnects and resumes  
✅ **Idempotency** — Deterministic job ID (`email-${emailId}`) ensures no duplicates  
✅ **Zero cron** — All scheduling is `delay` parameter in BullMQ, evaluated at job creation time  

---

## Architecture Diagram

```
Timeline:
┌─────────────────────────────────────────────────────────────────┐
│ T=0s: npm run test:restart                                       │
│   - Email saved to DB (status="scheduled")                       │
│   - Job enqueued in Redis with delay=120000ms                    │
│   - Worker sees delayed job, waits                               │
├─────────────────────────────────────────────────────────────────┤
│ T=10s: Kill API server (Ctrl+C)                                  │
│   - HTTP API down                                                │
│   - Job still in Redis (persisted)                               │
├─────────────────────────────────────────────────────────────────┤
│ T=15s: Kill worker (Ctrl+C)                                      │
│   - Worker shuts down                                            │
│   - Job STILL in Redis (unmodified)                              │
├─────────────────────────────────────────────────────────────────┤
│ T=20s: Restart API server (npm run dev)                          │
│   - Postgres + Redis reconnected                                 │
│   - No DB query to re-derive jobs (KEY: idempotency)             │
├─────────────────────────────────────────────────────────────────┤
│ T=25s: Restart worker (npm run worker)                           │
│   - Worker reconnects to Redis                                   │
│   - Discovers pending job in queue                               │
│   - Resumes as if never interrupted                              │
├─────────────────────────────────────────────────────────────────┤
│ T=120s: Job trigger time reached                                 │
│   - Worker processes job                                         │
│   - Updates DB: status="sent", sent_at=NOW()                     │
│   - Job removed from Redis (completed)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## What NOT to Do (Common Mistakes)

❌ **DO NOT re-query the DB on worker startup to re-derive jobs**  
→ This causes duplicates if a job was partially processed before restart

❌ **DO NOT store jobs in memory only**  
→ Jobs must live in Redis, survive process death

❌ **DO NOT use different job IDs each time (use UUIDs randomly)**  
→ Job ID must be deterministic based on email record ID

❌ **DO NOT use cron or node-schedule to trigger jobs**  
→ All timing is BullMQ's `delay` parameter

---

## Next Step: STEP 3 (Ethereal SMTP + Rate Limiting)

After verifying this restart test passes, we'll:
1. Integrate Ethereal Email (real SMTP, not mock)
2. Implement Redis rate-limit counters (per sender, per hour)
3. On rate limit hit: re-queue job with delay to next hour window
4. Prove rate-limit respects hourly windows

---

## Troubleshooting

### "Job is not triggering after restart"

**Diagnosis:**
1. Check Redis: `docker exec -it reachinbox-redis redis-cli KEYS 'bull:emails:*'`
2. Check worker logs for connection errors
3. Verify DATABASE_URL and REDIS_URL in .env

### "Email sent twice"

**This means idempotency failed.** Debug:
1. Check if job ID is truly deterministic: `console.log(jobId)` in `enqueueEmail()`
2. Check if worker is re-deriving jobs from DB on startup (it shouldn't)
3. Verify only one worker process is running

### "Worker won't reconnect after restart"

**Diagnosis:**
1. Check Redis is still running: `docker-compose ps`
2. Check REDIS_URL is correct
3. Look for connection errors in worker logs

---

## Proof of Completion

✅ Schedule an email to send 2 minutes out  
✅ Kill API server  
✅ Kill worker  
✅ Restart API server  
✅ Restart worker  
✅ Wait for scheduled time  
✅ Email sent exactly once (check DB)  
✅ No duplicates (count rows in DB)  
✅ Worker logs show single "Email [ID] marked as sent" message  

---

**STEP 2 READY TO COMMIT**
