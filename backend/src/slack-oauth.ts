import axios from 'axios';
import pool from './db';

/**
 * Slack OAuth Integration
 * 
 * Allows users to authorize ReachInbox to send Slack notifications
 * Stores webhook URLs per user for safe notification delivery
 */

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || 'http://localhost:3000/api/slack/oauth/callback';

/**
 * Initialize Slack OAuth tokens table
 */
export async function initializeSlackTokensTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slack_tokens (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        team_id VARCHAR(255),
        team_name VARCHAR(255),
        channel_id VARCHAR(255),
        channel_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ Slack tokens table initialized');
  } catch (error) {
    console.error('Error initializing Slack tokens table:', error);
  }
}

/**
 * Get Slack OAuth authorization URL
 */
export function getSlackAuthUrl(): string {
  const scopes = [
    'incoming-webhook',
    'users:read',
    'team:read',
  ];

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID || '',
    redirect_uri: SLACK_REDIRECT_URI,
    scope: scopes.join(','),
    state: Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64'),
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for token
 */
export async function exchangeCodeForToken(code: string): Promise<{
  webhookUrl: string;
  teamName: string;
  channelName: string;
} | null> {
  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: SLACK_REDIRECT_URI,
    });

    if (!response.data.ok) {
      console.error('Slack OAuth error:', response.data.error);
      return null;
    }

    return {
      webhookUrl: response.data.incoming_webhook.channel_id,
      teamName: response.data.team.name,
      channelName: response.data.incoming_webhook.channel,
    };
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    return null;
  }
}

/**
 * Store Slack token for user
 */
export async function storeSlackToken(
  userId: string,
  accessToken: string,
  webhookUrl: string,
  teamId: string,
  teamName: string,
  channelId: string,
  channelName: string
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO slack_tokens 
       (user_id, access_token, webhook_url, team_id, team_name, channel_id, channel_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         access_token = $2,
         webhook_url = $3,
         updated_at = NOW()`,
      [userId, accessToken, webhookUrl, teamId, teamName, channelId, channelName]
    );
    return true;
  } catch (error) {
    console.error('Error storing Slack token:', error);
    return false;
  }
}

/**
 * Get Slack webhook URL for user
 */
export async function getSlackWebhookUrl(userId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      'SELECT webhook_url FROM slack_tokens WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0].webhook_url : null;
  } catch (error) {
    console.error('Error getting Slack webhook:', error);
    return null;
  }
}

/**
 * Get Slack connection status for user
 */
export async function getSlackConnectionStatus(userId: string): Promise<{
  connected: boolean;
  teamName?: string;
  channelName?: string;
  connectedAt?: string;
} | null> {
  try {
    const result = await pool.query(
      `SELECT team_name, channel_name, created_at FROM slack_tokens WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { connected: false };
    }

    const row = result.rows[0];
    return {
      connected: true,
      teamName: row.team_name,
      channelName: row.channel_name,
      connectedAt: row.created_at,
    };
  } catch (error) {
    console.error('Error getting Slack connection status:', error);
    return null;
  }
}

/**
 * Disconnect Slack for user
 */
export async function disconnectSlack(userId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'DELETE FROM slack_tokens WHERE user_id = $1',
      [userId]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  } catch (error) {
    console.error('Error disconnecting Slack:', error);
    return false;
  }
}

/**
 * List all connected Slack workspaces (for admin)
 */
export async function listConnectedSlackWorkspaces(): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT 
        user_id, 
        team_id, 
        team_name, 
        channel_name, 
        created_at 
       FROM slack_tokens 
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error listing Slack workspaces:', error);
    return [];
  }
}
