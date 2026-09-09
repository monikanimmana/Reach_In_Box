import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

// Initialize Redis connection for BullMQ
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

// Email queue for scheduling delayed sends
export const emailQueue = new Queue('emails', { connection });

// Queue events for monitoring
export const queueEvents = new QueueEvents('emails', { connection });

/**
 * Enqueue an email to be sent at scheduledAt time
 * Job ID is deterministic (based on DB record ID) for idempotency
 * @param emailId - Database email record ID
 * @param sender - Sender email address
 * @param recipient - Recipient email address
 * @param subject - Email subject
 * @param body - Email body
 * @param scheduledAt - When to send (Unix timestamp in ms)
 */
export async function enqueueEmail(
  emailId: number,
  sender: string,
  recipient: string,
  subject: string,
  body: string,
  scheduledAt: number
): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, scheduledAt - now);

  await emailQueue.add(
    'send-email',
    {
      emailId,
      sender,
      recipient,
      subject,
      body,
      scheduledAt,
    },
    {
      jobId: `email-${emailId}`, // Deterministic ID ensures no duplicates on restart
      delay,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log(`✓ Email ${emailId} enqueued (delay: ${delay}ms)`);
}

/**
 * Initialize queue listeners (for debugging/monitoring)
 */
export function initializeQueueListeners(): void {
  queueEvents.on('added', ({ jobId }) => {
    console.log(`📧 Job added: ${jobId}`);
  });

  queueEvents.on('completed', ({ jobId }) => {
    console.log(`✅ Job completed: ${jobId}`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    console.log(`❌ Job failed: ${jobId} - ${failedReason}`);
  });

  queueEvents.on('delayed', ({ jobId, delay }) => {
    console.log(`⏳ Job delayed: ${jobId} (${delay}ms)`);
  });
}

export { connection };
