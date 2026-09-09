/**
 * Restart Test Script
 * 
 * This script demonstrates that emails survive server restart and fire exactly once.
 * 
 * Usage:
 *   1. Run: npx ts-node src/restart-test.ts
 *   2. Wait for "Email scheduled in 2 minutes..."
 *   3. Kill the API server (Ctrl+C on the "npm run dev" terminal)
 *   4. Restart the API server (npm run dev)
 *   5. Restart the worker (npm run worker)
 *   6. Wait ~2 minutes from original schedule time
 *   7. Verify email is sent EXACTLY ONCE (check DB or worker logs)
 * 
 * This verifies:
 * - BullMQ jobs persist in Redis even after server restart
 * - Worker reconnects and resumes pending jobs
 * - Deterministic job IDs prevent duplicates
 * - No cron or background timers — pure Redis-backed scheduling
 */

import axios from 'axios';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

async function runRestartTest() {
  try {
    console.log('🧪 RESTART TEST - Persistence & Idempotency Proof\n');
    console.log('⏱️  Scheduling email to send in 2 minutes...\n');

    // Calculate timestamp 2 minutes in the future
    const twoMinutesFromNow = Date.now() + 2 * 60 * 1000;
    const twoMinutesFromNowDate = new Date(twoMinutesFromNow);

    console.log(`📧 Email details:`);
    console.log(`   From: test@reachinbox.ai`);
    console.log(`   To: restart-test@example.com`);
    console.log(`   Subject: Restart Test - ${new Date().toISOString()}`);
    console.log(`   Scheduled for: ${twoMinutesFromNowDate.toISOString()}`);
    console.log(`   Timestamp (ms): ${twoMinutesFromNow}\n`);

    // Call the API to schedule the email
    const response = await axios.post(`${API_BASE}/api/emails`, {
      sender: 'test@reachinbox.ai',
      recipient: 'restart-test@example.com',
      subject: `Restart Test - ${new Date().toISOString()}`,
      body: `This email was scheduled at ${new Date().toISOString()} to test persistence across server restarts.\n\nIf you see this, the restart test PASSED.`,
      scheduledAt: twoMinutesFromNow,
    });

    console.log('✅ Email scheduled successfully!\n');
    console.log(`📝 Email ID: ${response.data.emailId}\n`);

    console.log('⚡ TEST INSTRUCTIONS:\n');
    console.log('1. WAIT ~10 seconds (let job propagate to Redis)');
    console.log('2. KILL the API server (Ctrl+C on "npm run dev" terminal)');
    console.log('3. KILL the worker process (Ctrl+C on "npm run worker" terminal)');
    console.log('4. RESTART the API server (npm run dev)');
    console.log('5. RESTART the worker (npm run worker)');
    console.log('6. WAIT for ~2 minutes from the scheduled time');
    console.log('7. CHECK: Email should be sent EXACTLY ONCE\n');

    console.log('✅ VERIFICATION POINTS:\n');
    console.log(`- Check database: SELECT * FROM emails WHERE id = ${response.data.emailId};`);
    console.log(`  Expected status: 'sent' (exactly once, no duplicates)\n`);
    console.log('- Check worker logs: Should see "✅ Email [ID] marked as sent" exactly once\n');
    console.log('- Check Redis job queue: Job should disappear after completion\n');

    console.log('📊 IDEMPOTENCY TEST:\n');
    console.log('If you accidentally run this script twice with the same Database,');
    console.log('the second enqueue call will be a no-op (same job ID).');
    console.log('This proves deterministic job IDs prevent duplicates.\n');

    console.log('🎯 SUCCESS CRITERIA:\n');
    console.log('✓ Email stored in DB with status="scheduled"');
    console.log('✓ Job queued in Redis with ID="email-N"');
    console.log('✓ Server can be killed and restarted');
    console.log('✓ Worker reconnects and resumes job');
    console.log('✓ Email sent EXACTLY ONCE (no duplicates, no re-sends from scratch)');
    console.log('✓ Status changed to "sent" in DB\n');

  } catch (error: any) {
    console.error('❌ Error scheduling email:', error.message);
    if (error.response?.data) {
      console.error('   Details:', error.response.data);
    }
    process.exit(1);
  }
}

runRestartTest();
