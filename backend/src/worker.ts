import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import pool from './db';

/**
 * Worker process that picks up email jobs from the queue and processes them
 * Runs in a separate process/thread
 * On restart, reconnects to Redis and resumes pending jobs
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

    try {
      // TODO: Implement SMTP sending in step 3
      // For now, just update DB status to 'sent'
      await pool.query(
        'UPDATE emails SET status = $1, sent_at = NOW() WHERE id = $2',
        ['sent', emailId]
      );

      console.log(`✅ Email ${emailId} marked as sent`);
      return { success: true, emailId };
    } catch (error) {
      console.error(`❌ Error processing job ${job.id}:`, error);
      
      // Update DB with failure reason
      await pool.query(
        'UPDATE emails SET status = $1, failed_reason = $2 WHERE id = $3',
        ['failed', String(error), emailId]
      );

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

console.log('🚀 Worker started. Listening for jobs...');
console.log(`   Concurrency: ${process.env.WORKER_CONCURRENCY || 5}`);
console.log(`   Min delay: ${process.env.MIN_DELAY_MS || 100}ms`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n⛔ Received SIGTERM, shutting down worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⛔ Received SIGINT, shutting down worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});
