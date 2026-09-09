import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db';
import { initializeDatabase } from './db';
import { enqueueEmail, initializeQueueListeners, emailQueue } from './queue';
import { initializeTransporter } from './smtp';
import { getRateLimitStatus } from './rate-limiter';
import { testSlackNotification, notifyRateLimitHit } from './slack';
import { initializeSearchIndexes, searchEmails, advancedSearch } from './search';
import { initializeElasticsearch, indexEmail } from './elasticsearch';
import { createBullMQRoutes } from './bullmq-ui';
import {
  initializeSlackTokensTable,
  getSlackAuthUrl,
  exchangeCodeForToken,
  storeSlackToken,
  getSlackConnectionStatus,
  disconnectSlack,
} from './slack-oauth';
import { connection as redisConnection } from './queue';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize queue listeners
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
 */
app.post('/api/emails', async (req: Request, res: Response) => {
  try {
    const { sender, recipient, subject, body, scheduledAt } = req.body;

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

    const result = await pool.query(
      'INSERT INTO emails (sender, recipient, subject, body, status, scheduled_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id',
      [sender, recipient, subject, body, 'scheduled', new Date(scheduledAt)]
    );

    const emailId = result.rows[0].id;

    await enqueueEmail(emailId, sender, recipient, subject, body, scheduledAt);

    // Index in Elasticsearch
    await indexEmail({
      id: emailId,
      sender,
      recipient,
      subject,
      body,
      status: 'scheduled',
      scheduled_at: new Date(scheduledAt).toISOString(),
      created_at: new Date().toISOString(),
    });

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
 * Get sent/failed emails
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
 * Search emails (Elasticsearch)
 * GET /api/emails/search?q=term
 */
app.get('/api/emails/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({
        error: 'Missing required query parameter: q',
      });
    }

    const results = await searchEmails(q);

    res.json({
      success: true,
      query: q,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error('Error searching emails:', error);
    res.status(500).json({
      error: 'Failed to search emails',
      details: String(error),
    });
  }
});

/**
 * Advanced search with filters
 * GET /api/emails/search/advanced?q=term&sender=test@example.com&status=sent
 */
app.get('/api/emails/search/advanced', async (req: Request, res: Response) => {
  try {
    const { q, sender, status, startDate, endDate } = req.query;

    const filters = {
      sender: typeof sender === 'string' ? sender : undefined,
      status: typeof status === 'string' ? status : undefined,
      startDate: typeof startDate === 'string' ? new Date(startDate) : undefined,
      endDate: typeof endDate === 'string' ? new Date(endDate) : undefined,
    };

    const results = await advancedSearch(
      typeof q === 'string' ? q : '',
      filters
    );

    res.json({
      success: true,
      query: q || '',
      filters,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({
      error: 'Failed to search emails',
      details: String(error),
    });
  }
});

/**
 * Get rate limit status
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
 * Test Slack webhook
 * POST /api/slack/test
 */
app.post('/api/slack/test', async (req: Request, res: Response) => {
  try {
    await testSlackNotification();
    res.json({
      success: true,
      message: 'Test notification sent to Slack',
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      error: 'Failed to send test notification',
      details: String(error),
      hint: 'Make sure SLACK_WEBHOOK_URL is set in .env',
    });
  }
});

/**
 * Slack OAuth: Get authorization URL
 * GET /api/slack/oauth/authorize
 */
app.get('/api/slack/oauth/authorize', (req: Request, res: Response) => {
  try {
    const authUrl = getSlackAuthUrl();
    res.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get authorization URL',
      details: String(error),
    });
  }
});

/**
 * Slack OAuth: Handle callback
 * GET /api/slack/oauth/callback?code=...&state=...
 */
app.get('/api/slack/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const tokenData = await exchangeCodeForToken(code);

    if (!tokenData) {
      return res.status(400).json({ error: 'Failed to exchange code for token' });
    }

    // For now, store with a default user ID (in production, use actual user ID from session)
    const userId = 'default-user';
    const webhookUrl = tokenData.webhookUrl;

    await storeSlackToken(
      userId,
      'token', // Access token (simplified)
      webhookUrl,
      'team-id',
      tokenData.teamName,
      'channel-id',
      tokenData.channelName
    );

    res.json({
      success: true,
      message: 'Slack connected successfully',
      team: tokenData.teamName,
      channel: tokenData.channelName,
    });
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({
      error: 'OAuth callback failed',
      details: String(error),
    });
  }
});

/**
 * Get Slack connection status
 * GET /api/slack/status
 */
app.get('/api/slack/status', async (req: Request, res: Response) => {
  try {
    const userId = 'default-user'; // In production, use actual user ID
    const status = await getSlackConnectionStatus(userId);

    res.json({
      success: true,
      status,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get Slack status',
      details: String(error),
    });
  }
});

/**
 * Disconnect Slack
 * POST /api/slack/disconnect
 */
app.post('/api/slack/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = 'default-user'; // In production, use actual user ID
    const success = await disconnectSlack(userId);

    res.json({
      success,
      message: success ? 'Slack disconnected' : 'Failed to disconnect Slack',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to disconnect Slack',
      details: String(error),
    });
  }
});

// Mount BullMQ queue routes
app.use(createBullMQRoutes(emailQueue, redisConnection));

/**
 * Start the server
 */
async function start() {
  try {
    // Initialize database
    await initializeDatabase();

    // Initialize Slack tokens table
    await initializeSlackTokensTable();

    // Test database connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('✓ Database connected:', testResult.rows[0]);

    // Initialize Postgres full-text search indexes
    await initializeSearchIndexes();

    // Initialize Elasticsearch
    await initializeElasticsearch();

    // Initialize Ethereal SMTP
    await initializeTransporter();

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n🚀 Backend running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
      console.log(`   Elasticsearch: ${process.env.ELASTICSEARCH_URL || 'http://localhost:9200'}`);
      console.log(`   Database: ${process.env.DATABASE_URL ? '✓ connected' : '✗ not configured'}`);
      console.log(`   Slack: ${process.env.SLACK_WEBHOOK_URL ? '✓ webhook configured' : '✗ webhook not configured'}`);
      console.log(`\n📊 API Endpoints:`);
      console.log(`   - Queue Dashboard: http://localhost:${PORT}/api/queue/status`);
      console.log(`   - Slack OAuth: http://localhost:${PORT}/api/slack/oauth/authorize`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
