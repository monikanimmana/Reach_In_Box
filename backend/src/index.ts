import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db';
import { initializeDatabase } from './db';
import { enqueueEmail, initializeQueueListeners } from './queue';
import { initializeTransporter } from './smtp';
import { getRateLimitStatus } from './rate-limiter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize queue listeners (for debugging)
initializeQueueListeners();

/**
 * Health check endpoint
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Schedule a new email
 * POST /api/emails
 * Body: { sender, recipient, subject, body, scheduledAt }
 * scheduledAt: Unix timestamp in milliseconds
 */
app.post('/api/emails', async (req: Request, res: Response) => {
  try {
    const { sender, recipient, subject, body, scheduledAt } = req.body;

    // Validate input
    if (!sender || !recipient || !subject || !body || !scheduledAt) {
      return res.status(400).json({
        error: 'Missing required fields: sender, recipient, subject, body, scheduledAt',
      });
    }

    if (typeof scheduledAt !== 'number' || scheduledAt <= 0) {
      return res.status(400).json({
        error: 'scheduledAt must be a valid Unix timestamp in milliseconds',
      });
    }

    // Insert into database
    const result = await pool.query(
      'INSERT INTO emails (sender, recipient, subject, body, status, scheduled_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id',
      [sender, recipient, subject, body, 'scheduled', new Date(scheduledAt)]
    );

    const emailId = result.rows[0].id;

    // Enqueue the job
    await enqueueEmail(emailId, sender, recipient, subject, body, scheduledAt);

    // Get rate limit status for response
    const rateLimitStatus = await getRateLimitStatus(sender);

    res.status(201).json({
      success: true,
      emailId,
      message: `Email scheduled for ${new Date(scheduledAt).toISOString()}`,
      rateLimit: rateLimitStatus,
    });
  } catch (error) {
    console.error('Error scheduling email:', error);
    res.status(500).json({
      error: 'Failed to schedule email',
      details: String(error),
    });
  }
});

/**
 * Get scheduled emails
 * GET /api/emails?status=scheduled
 */
app.get('/api/emails', async (req: Request, res: Response) => {
  try {
    const { status = 'scheduled' } = req.query;

    const result = await pool.query(
      'SELECT id, sender, recipient, subject, status, scheduled_at, created_at, sent_at, failed_reason FROM emails WHERE status = $1 ORDER BY scheduled_at DESC LIMIT 100',
      [status]
    );

    res.json({
      success: true,
      count: result.rows.length,
      emails: result.rows,
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({
      error: 'Failed to fetch emails',
      details: String(error),
    });
  }
});

/**
 * Get sent emails
 * GET /api/emails/sent
 */
app.get('/api/emails/sent', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, sender, recipient, subject, status, scheduled_at, sent_at, created_at FROM emails WHERE status IN ($1, $2) ORDER BY sent_at DESC LIMIT 100',
      ['sent', 'failed']
    );

    res.json({
      success: true,
      count: result.rows.length,
      emails: result.rows,
    });
  } catch (error) {
    console.error('Error fetching sent emails:', error);
    res.status(500).json({
      error: 'Failed to fetch sent emails',
      details: String(error),
    });
  }
});

/**
 * Get rate limit status for a sender
 * GET /api/rate-limit/:sender
 */
app.get('/api/rate-limit/:sender', async (req: Request, res: Response) => {
  try {
    const { sender } = req.params;
    const status = await getRateLimitStatus(sender);

    res.json({
      success: true,
      rateLimit: status,
    });
  } catch (error) {
    console.error('Error fetching rate limit status:', error);
    res.status(500).json({
      error: 'Failed to fetch rate limit status',
      details: String(error),
    });
  }
});

/**
 * Start the server
 */
async function start() {
  try {
    // Initialize database
    await initializeDatabase();

    // Test database connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('✓ Database connected:', testResult.rows[0]);

    // Initialize Ethereal SMTP
    await initializeTransporter();

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n🚀 Backend running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
      console.log(`   Database: ${process.env.DATABASE_URL ? '✓ connected' : '✗ not configured'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
