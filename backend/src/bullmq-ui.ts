import { Router } from 'express';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/**
 * BullMQ Queue Management Routes
 * Provides live dashboard data for queue monitoring
 */

export function createBullMQRoutes(emailQueue: Queue, redis: Redis): Router {
  const router = Router();

  /**
   * Get queue status and job counts
   */
  router.get('/api/queue/status', async (req, res) => {
    try {
      const [
        waitingCount,
        activeCount,
        delayedCount,
        failedCount,
        completedCount,
      ] = await Promise.all([
        emailQueue.getWaitingCount(),
        emailQueue.getActiveCount(),
        emailQueue.getDelayedCount(),
        emailQueue.getFailedCount(),
        emailQueue.getCompletedCount(),
      ]);

      const stats = await emailQueue.getStats();

      res.json({
        success: true,
        status: 'operational',
        queue: {
          name: 'emails',
          waiting: waitingCount,
          active: activeCount,
          delayed: delayedCount,
          failed: failedCount,
          completed: completedCount,
          total: waitingCount + activeCount + delayedCount + failedCount + completedCount,
        },
        stats,
      });
    } catch (error) {
      console.error('Error fetching queue status:', error);
      res.status(500).json({
        error: 'Failed to fetch queue status',
        details: String(error),
      });
    }
  });

  /**
   * Get active jobs
   */
  router.get('/api/queue/jobs/active', async (req, res) => {
    try {
      const jobs = await emailQueue.getActiveJobs();
      res.json({
        success: true,
        count: jobs.length,
        jobs: jobs.map((job) => ({
          id: job.id,
          data: job.data,
          progress: job.progress(),
          timestamp: job.timestamp,
          attemptsMade: job.attemptsMade,
        })),
      });
    } catch (error) {
      console.error('Error fetching active jobs:', error);
      res.status(500).json({ error: 'Failed to fetch active jobs' });
    }
  });

  /**
   * Get delayed jobs
   */
  router.get('/api/queue/jobs/delayed', async (req, res) => {
    try {
      const jobs = await emailQueue.getDelayedJobs();
      res.json({
        success: true,
        count: jobs.length,
        jobs: jobs.map((job) => ({
          id: job.id,
          data: job.data,
          timestamp: job.timestamp,
          delay: job.delay,
        })),
      });
    } catch (error) {
      console.error('Error fetching delayed jobs:', error);
      res.status(500).json({ error: 'Failed to fetch delayed jobs' });
    }
  });

  /**
   * Get failed jobs
   */
  router.get('/api/queue/jobs/failed', async (req, res) => {
    try {
      const jobs = await emailQueue.getFailedJobs();
      res.json({
        success: true,
        count: jobs.length,
        jobs: jobs.slice(0, 50).map((job) => ({
          id: job.id,
          data: job.data,
          failedReason: job.failedReason,
          timestamp: job.timestamp,
          attemptsMade: job.attemptsMade,
        })),
      });
    } catch (error) {
      console.error('Error fetching failed jobs:', error);
      res.status(500).json({ error: 'Failed to fetch failed jobs' });
    }
  });

  /**
   * Get job details
   */
  router.get('/api/queue/jobs/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await emailQueue.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({
        success: true,
        job: {
          id: job.id,
          data: job.data,
          state: await job.getState(),
          progress: job.progress(),
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts,
          failedReason: job.failedReason,
          returnvalue: job.returnvalue,
          timestamp: job.timestamp,
        },
      });
    } catch (error) {
      console.error('Error fetching job:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  /**
   * Get queue metrics over time
   */
  router.get('/api/queue/metrics', async (req, res) => {
    try {
      const [
        processing,
        completed,
        failed,
        delayed,
      ] = await Promise.all([
        emailQueue.count('active'),
        emailQueue.count('completed'),
        emailQueue.count('failed'),
        emailQueue.count('delayed'),
      ]);

      res.json({
        success: true,
        metrics: {
          processing,
          completed,
          failed,
          delayed,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error fetching metrics:', error);
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  return router;
}
