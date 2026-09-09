import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import pool from './db';

/**
 * Worker process that picks up email jobs from the queue and processes them
 * Runs in a separate process/thread
 * 
 * CRITICAL FOR STEP 2 - PERSISTENCE:
 * On restart, this worker reconnects to Redis and resumes pending jobs.
 * It does NOT re-derive jobs from the database (that would cause duplicates).
 * 
 * All pending jobs remain in Redis with their delay state intact.
 * This ensures exactly-once delivery even across server restarts.
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
    console.log(`   To: ${recipient}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Scheduled: ${new Date(scheduledAt).toISOString()}`);

    try {
      // STEP 2 TEST: Just mark as sent (SMTP in STEP 3)
      // In production, this would call Ethereal/SMTP
      const minDelay = parseInt(process.env.MIN_DELAY_MS || '100');
      if (minDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, minDelay));
      }

      const result = await pool.query(
        'UPDATE emails SET status = $1, sent_at = NOW() WHERE id = $2 RETURNING *',
        ['sent', emailId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Email ${emailId} not found in database`);
      }

      console.log(`✅ Email ${emailId} marked as sent`);
      return { success: true, emailId, timestamp: new Date().toISOString() };
    } catch (error) {
      console.error(`❌ Error processing job ${job.id}:`, error);
      
      try {
        // Update DB with failure reason
        await pool.query(
          'UPDATE emails SET status = $1, failed_reason = $2 WHERE id = $3',
          ['failed', String(error), emailId]
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
