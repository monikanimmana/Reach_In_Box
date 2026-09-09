import nodemailer from 'nodemailer';

/**
 * Ethereal Email Transporter
 * 
 * Real SMTP sending (not mocked). Supports multiple sender identities
 * via sender email configuration in Ethereal.
 * 
 * For testing/demo:
 * - Create account at https://ethereal.email
 * - Set ETHEREAL_USER and ETHEREAL_PASS in .env
 * - Preview sent emails at https://ethereal.email/messages
 */

let transporter: nodemailer.Transporter | null = null;

/**
 * Initialize Ethereal transporter
 * Call this on server startup
 */
export async function initializeTransporter(): Promise<void> {
  const etherealUser = process.env.ETHEREAL_USER;
  const etherealPass = process.env.ETHEREAL_PASS;

  if (!etherealUser || !etherealPass) {
    console.warn('⚠️  Ethereal credentials not configured');
    console.warn('   ETHEREAL_USER:', etherealUser ? '***' : 'not set');
    console.warn('   ETHEREAL_PASS:', etherealPass ? '***' : 'not set');
    console.warn('   Emails will be logged but not sent');
    return;
  }

  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: etherealUser,
      pass: etherealPass,
    },
  });

  // Verify connection
  try {
    await transporter.verify();
    console.log('✓ Ethereal SMTP connected');
    console.log(`   User: ${etherealUser}`);
  } catch (error) {
    console.error('❌ Ethereal SMTP verification failed:', error);
    throw error;
  }
}

/**
 * Send an email via Ethereal
 * 
 * @param sender - Sender email address (must be configured in Ethereal account)
 * @param recipient - Recipient email address
 * @param subject - Email subject
 * @param body - Email body (HTML or plain text)
 * @returns Preview URL (for Ethereal test emails)
 */
export async function sendEmail(
  sender: string,
  recipient: string,
  subject: string,
  body: string
): Promise<{ messageId: string; previewUrl?: string }> {
  if (!transporter) {
    console.warn(`📧 [DRY RUN] Would send: ${subject} from ${sender} to ${recipient}`);
    return {
      messageId: `dry-run-${Date.now()}`,
    };
  }

  try {
    const info = await transporter.sendMail({
      from: sender,
      to: recipient,
      subject,
      text: body,
      html: body, // Treat body as HTML if it contains HTML tags, plain text otherwise
    });

    console.log(`✅ Email sent: ${info.messageId}`);
    console.log(`   From: ${sender}`);
    console.log(`   To: ${recipient}`);
    console.log(`   Subject: ${subject}`);

    // Ethereal provides a preview URL for test emails
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`   Preview: ${previewUrl}`);
    }

    return {
      messageId: info.messageId,
      previewUrl,
    };
  } catch (error) {
    console.error(`❌ Failed to send email:`, error);
    throw error;
  }
}

/**
 * Test the transporter (run manually to verify Ethereal setup)
 */
export async function testTransporter(): Promise<void> {
  if (!transporter) {
    throw new Error('Transporter not initialized. Set Ethereal credentials in .env');
  }

  const testEmail = {
    from: process.env.ETHEREAL_USER,
    to: 'test@example.com',
    subject: 'Test Email from ReachInbox',
    text: 'This is a test email to verify Ethereal SMTP is working.',
  };

  try {
    const info = await transporter.sendMail(testEmail);
    console.log('✓ Test email sent successfully');
    console.log('   Message ID:', info.messageId);
    console.log('   Preview URL:', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('❌ Test email failed:', error);
    throw error;
  }
}
