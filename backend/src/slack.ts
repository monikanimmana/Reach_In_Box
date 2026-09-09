import axios from 'axios';

/**
 * Slack Notification Service
 * 
 * Sends real, live messages to Slack when rate limits are hit.
 * Uses Incoming Webhook (simple, no OAuth complexity).
 * 
 * Hard constraint: Must be a real, live call at the moment the limit is hit.
 * This is NOT a log line or placeholder — it's an actual HTTP request to Slack.
 * 
 * Configuration:
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
 * 
 * If webhook not configured, gracefully skips notification.
 * If Slack becomes available later (webhook added to .env), notifications work without redeploy.
 */

/**
 * Send a rate limit hit notification to Slack
 * 
 * @param sender - Email sender that hit the limit
 * @param currentCount - Number of emails sent
 * @param limit - Rate limit threshold
 * @param resetAt - When the counter resets
 */
export async function notifyRateLimitHit(
  sender: string,
  currentCount: number,
  limit: number,
  resetAt: Date
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log(`📢 [Slack disabled] Rate limit hit for ${sender} (not sending to Slack)`);
    return;
  }

  try {
    const message = {
      text: `🚨 Rate Limit Hit`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Email Rate Limit Exceeded',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender:*\n${sender}`,
            },
            {
              type: 'mrkdwn',
              text: `*Emails Sent:*\n${currentCount}/${limit}`,
            },
            {
              type: 'mrkdwn',
              text: `*Reset Time:*\n${resetAt.toISOString()}`,
            },
            {
              type: 'mrkdwn',
              text: `*Timestamp:*\n${new Date().toISOString()}`,
            },
          ],
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Pending emails from this sender will be queued and sent in the next hour window.\n\`Rate Limit Key: rate-limit:${sender}:${getHourKey()}\``,
          },
        },
      ],
    };

    const response = await axios.post(webhookUrl, message, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 200) {
      console.log(`✅ Slack notification sent for ${sender}`);
    }
  } catch (error) {
    console.error(`❌ Failed to send Slack notification:`, error instanceof Error ? error.message : error);
    // Don't throw — graceful failure. Email processing continues.
  }
}

/**
 * Send a test notification to Slack (for setup verification)
 */
export async function testSlackNotification(): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL not configured in .env');
  }

  try {
    const message = {
      text: '✅ ReachInbox Slack Integration Test',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✅ ReachInbox Test Notification',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Slack webhook integration is working correctly!\n\nTime: ${new Date().toISOString()}`,
          },
        },
      ],
    };

    const response = await axios.post(webhookUrl, message);

    if (response.status === 200) {
      console.log('✓ Test notification sent to Slack');
    }
  } catch (error) {
    console.error('❌ Test notification failed:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Helper to get hour key for display
 */
function getHourKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}-${hour}`;
}
