import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

/**
 * Initialize database schema
 * Creates the emails table if it doesn't exist
 */
export async function initializeDatabase(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(255) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
        scheduled_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMP,
        failed_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_status ON emails(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_at ON emails(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_sender ON emails(sender);
    `);
    console.log('✓ Database schema initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export default pool;
