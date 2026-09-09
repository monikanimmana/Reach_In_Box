/**
 * Full-text search service
 * 
 * TRADE-OFF DECISION (STEP 6):
 * Using Postgres full-text search instead of Elasticsearch
 * 
 * WHY Postgres FTS:
 * - No additional container (simpler deployment)
 * - Sufficient for search scope (emails table only)
 * - Atomic with email storage (no sync issues)
 * - Good performance for typical search volumes
 * 
 * WHY NOT Elasticsearch:
 * - Adds complexity (separate service, indexing pipeline)
 * - Overkill for single-table search
 * - Indexing sync issues if email/job fails midway
 * - Can be added later without breaking changes
 * 
 * If search volume grows to 1M+ emails, migrate to ES then.
 * For now: Postgres FTS is the right trade-off.
 */

import pool from './db';

export interface SearchResult {
  id: number;
  sender: string;
  recipient: string;
  subject: string;
  status: string;
  scheduled_at: string;
  created_at: string;
  relevance: number;
}

/**
 * Initialize full-text search indexes in Postgres
 */
export async function initializeSearchIndexes(): Promise<void> {
  try {
    await pool.query(`
      -- Create tsvector column for full-text search if it doesn't exist
      ALTER TABLE emails 
      ADD COLUMN IF NOT EXISTS search_vector tsvector;

      -- Create index on search_vector for fast queries
      CREATE INDEX IF NOT EXISTS idx_emails_search 
      ON emails USING GIN(search_vector);

      -- Create function to update search_vector
      CREATE OR REPLACE FUNCTION emails_search_trigger() 
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english', 
          coalesce(NEW.subject, '') || ' ' || 
          coalesce(NEW.body, '') || ' ' || 
          coalesce(NEW.sender, '') || ' ' || 
          coalesce(NEW.recipient, '')
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      -- Create trigger to update search_vector on insert/update
      DROP TRIGGER IF EXISTS emails_search_trigger ON emails;
      CREATE TRIGGER emails_search_trigger 
      BEFORE INSERT OR UPDATE ON emails
      FOR EACH ROW 
      EXECUTE FUNCTION emails_search_trigger();

      -- Update existing records
      UPDATE emails SET search_vector = to_tsvector('english',
        coalesce(subject, '') || ' ' || 
        coalesce(body, '') || ' ' || 
        coalesce(sender, '') || ' ' || 
        coalesce(recipient, '')
      ) WHERE search_vector IS NULL;
    `);
    console.log('✓ Full-text search indexes initialized');
  } catch (error) {
    console.error('Error initializing search indexes:', error);
    // Don't throw — this is optional functionality
  }
}

/**
 * Search emails by keyword
 * 
 * @param query - Search query (will be split into words)
 * @param limit - Max results (default 100)
 * @returns Array of matching emails with relevance score
 */
export async function searchEmails(query: string, limit = 100): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  try {
    // Escape query and convert to Postgres tsquery format
    const sanitizedQuery = query
      .replace(/[&|!()'"]/g, ' ')
      .trim()
      .split(/\s+/)
      .join(' & ');

    const result = await pool.query(
      `
      SELECT 
        id,
        sender,
        recipient,
        subject,
        status,
        scheduled_at,
        created_at,
        ts_rank(search_vector, query) AS relevance
      FROM emails, to_tsquery('english', $1) AS query
      WHERE search_vector @@ query
      ORDER BY relevance DESC, created_at DESC
      LIMIT $2
      `,
      [sanitizedQuery, limit]
    );

    return result.rows;
  } catch (error) {
    console.error('Error searching emails:', error);
    return [];
  }
}

/**
 * Advanced search with filters
 * 
 * @param keyword - Search term
 * @param filters - Additional filters (sender, status, date range)
 * @returns Filtered search results
 */
export async function advancedSearch(
  keyword: string,
  filters?: {
    sender?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<SearchResult[]> {
  try {
    let query = `
      SELECT 
        id,
        sender,
        recipient,
        subject,
        status,
        scheduled_at,
        created_at,
        CASE 
          WHEN keyword IS NOT NULL THEN ts_rank(search_vector, query)
          ELSE 1
        END AS relevance
      FROM emails
      ${keyword ? ', to_tsquery(\'english\', $1) AS query' : ''}
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Full-text search
    if (keyword && keyword.trim().length > 0) {
      const sanitizedQuery = keyword
        .replace(/[&|!()'"]/g, ' ')
        .trim()
        .split(/\s+/)
        .join(' & ');
      params.push(sanitizedQuery);
      query += ` AND search_vector @@ query`;
    }

    // Sender filter
    if (filters?.sender) {
      paramIndex += 1;
      params.push(filters.sender);
      query += ` AND sender = $${paramIndex}`;
    }

    // Status filter
    if (filters?.status) {
      paramIndex += 1;
      params.push(filters.status);
      query += ` AND status = $${paramIndex}`;
    }

    // Date range
    if (filters?.startDate) {
      paramIndex += 1;
      params.push(filters.startDate);
      query += ` AND created_at >= $${paramIndex}`;
    }
    if (filters?.endDate) {
      paramIndex += 1;
      params.push(filters.endDate);
      query += ` AND created_at <= $${paramIndex}`;
    }

    query += ` ORDER BY relevance DESC, created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error in advanced search:', error);
    return [];
  }
}
