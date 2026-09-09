import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import pool from './db';
import { sendEmail } from './smtp';
import { checkRateLimit, incrementRateLimit, getDelayToNextHour } from './rate-limiter';
import { enqueueEmail } from './queue';

/**
 * Worker process that picks up email jobs from the queue and processes them
 * 
 * Processing pipeline:
 * 1. Check rate limit for sender
 * 2. If limit hit: re-queue job with delay to next hour window
 * 3. If allowed: send email via Ethereal SMTP
 * 4. Update DB status (sent/failed)
 * 5. Increment rate limit counter
 * 
 * CRITICAL FOR STEP 2 - PERSISTENCE:
 * On restart, reconnects to Redis and resumes pending jobs.
 * No DB re-derivation (that causes duplicates).
 */

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'emails',
  async (job: Job) => {
    const { emailId, sender, recipient, subject, body, scheduledAt } = job.data;

    console.log(`\n🔄 Processing job: ${job.id}`);
    console.log(`   Email ID: ${emailId}`);
    console.log(`   From: ${sender}`);
    console.log(`   To: ${recipient}`);
    console.log(`   Subject: ${subject}`);

    try {
      // STEP 3: Check rate limit
      const rateLimit = await checkRateLimit(sender);
      
      if (!rateLimit.allowed) {
        console.log(`⏳ Rate limit hit for ${sender}`);
        console.log(`   Current: ${rateLimit.count}/${rateLimit.limit}`);
        console.log(`   Resetting at: ${rateLimit.resetAt.toISOString()}`);

        // Re-queue the job with delay to next hour
        const delayMs = getDelayToNextHour();
        console.log(`   Re-queueing with ${delayMs}ms delay`);

        await enqueueEmail(emailId, sender, recipient, subject, body, Date.now() + delayMs);

        // Throw to mark this attempt as failed (it will retry after delay)
        throw new Error(
          `Rate limit exceeded for ${sender}. Re-queued for next hour window.`
        );
      }

      // STEP 3: Send email via Ethereal
      const sendResult = await sendEmail(sender, recipient, subject, body);

      // Update DB with success
      const result = await pool.query(
        'UPDATE emails SET status = $1, sent_at = NOW() WHERE id = $2 RETURNING *',
        ['sent', emailId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Email ${emailId} not found in database`);
      }

      // Increment rate limit counter
      const newCount = await incrementRateLimit(sender);
      console.log(`✅ Email ${emailId} sent`);
      console.log(`   Message ID: ${sendResult.messageId}`);
      console.log(`   Rate limit: ${newCount}/${rateLimit.limit}`);
      if (sendResult.previewUrl) {
        console.log(`   Preview: ${sendResult.previewUrl}`);
      }

      return {
        success: true,
        emailId,
        messageId: sendResult.messageId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`❌ Error processing job ${job.id}:`, error);

      // Update DB with failure
      try {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // If this is a rate limit re-queue, don't mark as failed in DB yet
        if (errorMsg.includes('Rate limit exceeded')) {
          console.log(`   (Job will be retried in next hour window)`);
          throw error; // Re-throw so BullMQ retries according to backoff config
        }

        await pool.query(
          'UPDATE emails SET status = $1, failed_reason = $2 WHERE id = $3',
          ['failed', errorMsg, emailId]
        );
      } catch (dbError) {
        console.error(`❌ Also failed to update DB:`, dbError);
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
  }
);

worker.on('completed', (job) => {
  console.log(`✓ Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.log(`✗ Job ${job?.id} failed: ${err.message}`);
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});

worker.on('ready', () => {
  console.log('✓ Worker ready and listening to queue');
});

console.log('\n🚀 Worker initialized');
console.log(`   Queue name: emails`);
console.log(`   Concurrency: ${process.env.WORKER_CONCURRENCY || 5}`);
console.log(`   Min delay between sends: ${process.env.MIN_DELAY_MS || 100}ms`);
console.log(`   Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
console.log('\n⏳ Listening for jobs... (Ctrl+C to stop)\n');

// Graceful shutdown with cleanup
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n⛔ Received ${signal}, shutting down worker gracefully...`);
  try {
    await worker.close();
    console.log('✓ Worker closed');

    await connection.quit();
    console.log('✓ Redis connection closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
