import { Redis } from 'ioredis';
import { notifyRateLimitHit } from './slack';

/**
 * Redis-backed rate limiter
 * 
 * Tracks emails sent per sender within hourly windows.
 * Uses Redis INCR + TTL for atomic counting and automatic expiry.
 * 
 * Hard constraint: Rate limits MUST NOT be in-memory only.
 * This implementation survives multiple worker instances and server restarts.
 */

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const MAX_EMAILS_PER_HOUR = parseInt(process.env.MAX_EMAILS_PER_HOUR || '100');
const MAX_EMAILS_PER_HOUR_PER_SENDER = parseInt(
  process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || '50'
);

/**
 * Track which senders have already been notified of rate limit in this hour
 * (prevent spam of multiple notifications for same sender)
 * Keys: "rate-limit-notified:{sender}:{hour}"
 */
const notifiedSenders = new Set<string>();

/**
 * Get the current hourly window key
 * E.g., "sender@example.com:2026-09-09-21" (hour 21 on that date)
 */
function getHourKey(sender: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  return `rate-limit:${sender}:${year}-${month}-${day}-${hour}`;
}

/**
 * Get the next hourly window key
 */
function getNextHourKey(sender: string): string {
  const next = new Date();
  next.setUTCHours(next.getUTCHours() + 1);
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const day = String(next.getUTCDate()).padStart(2, '0');
  const hour = String(next.getUTCHours()).padStart(2, '0');
  return `rate-limit:${sender}:${year}-${month}-${day}-${hour}`;
}

/**
 * Get milliseconds until the next hour window
 */
function getMsToNextHour(): number {
  const now = new Date();
  const nextHour = new Date(now.getTime());
  nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
  return nextHour.getTime() - now.getTime();
}

/**
 * Check if a sender has hit their hourly limit
 * Returns: { allowed: boolean, count: number, limit: number, resetAt: Date }
 */
export async function checkRateLimit(sender: string): Promise<{
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: Date;
}> {
  const hourKey = getHourKey(sender);
  const msToNextHour = getMsToNextHour();

  // Get current count
  const countStr = await redis.get(hourKey);
  const count = parseInt(countStr || '0');

  const limit = MAX_EMAILS_PER_HOUR_PER_SENDER;
  const resetAt = new Date(Date.now() + msToNextHour);

  // If limit hit and not yet notified, trigger Slack notification
  if (count >= limit && !notifiedSenders.has(hourKey)) {
    notifiedSenders.add(hourKey);
    // Fire notification asynchronously (don't block job processing)
    notifyRateLimitHit(sender, count, limit, resetAt).catch((err) => {
      console.error('Error sending rate limit notification:', err);
    });
  }

  return {
    allowed: count < limit,
    count,
    limit,
    resetAt,
  };
}

/**
 * Increment the rate limit counter for a sender
 * Atomically increments the counter and sets TTL to 1 hour
 * 
 * @returns number of emails sent so far (after increment)
 */
export async function incrementRateLimit(sender: string): Promise<number> {
  const hourKey = getHourKey(sender);
  
  // INCR is atomic
  const count = await redis.incr(hourKey);

  // Set TTL to 1 hour (3600 seconds) on first increment
  if (count === 1) {
    await redis.expire(hourKey, 3600);
  }

  return count;
}

/**
 * Calculate delay until the next hour (for re-queueing on rate limit)
 * 
 * @returns milliseconds until next hour window
 */
export function getDelayToNextHour(): number {
  return getMsToNextHour();
}

/**
 * Get current rate limit status (for API responses)
 */
export async function getRateLimitStatus(sender: string): Promise<{
  hourKey: string;
  currentCount: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  resetAt: string;
}> {
  const hourKey = getHourKey(sender);
  const countStr = await redis.get(hourKey);
  const count = parseInt(countStr || '0');
  const limit = MAX_EMAILS_PER_HOUR_PER_SENDER;
  const msToNextHour = getMsToNextHour();
  const resetAt = new Date(Date.now() + msToNextHour);

  return {
    hourKey,
    currentCount: count,
    limit,
    remaining: Math.max(0, limit - count),
    percentUsed: Math.round((count / limit) * 100),
    resetAt: resetAt.toISOString(),
  };
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}

console.log(`📊 Rate Limiter initialized`);
console.log(`   Max emails per hour (global): ${MAX_EMAILS_PER_HOUR}`);
console.log(`   Max emails per sender per hour: ${MAX_EMAILS_PER_HOUR_PER_SENDER}`);
