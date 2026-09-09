import { Client } from '@elastic/elasticsearch';

/**
 * Elasticsearch client for indexing and searching emails
 * 
 * Indexes emails on send/schedule for full-text search
 * Supports filtering by sender, status, date range
 */

const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

const INDEX_NAME = 'emails';

/**
 * Initialize Elasticsearch index with mappings
 */
export async function initializeElasticsearch(): Promise<void> {
  try {
    // Check if index exists
    const indexExists = await client.indices.exists({ index: INDEX_NAME });

    if (!indexExists) {
      // Create index with mappings
      await client.indices.create({
        index: INDEX_NAME,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              sender: { type: 'keyword' },
              recipient: { type: 'keyword' },
              subject: { type: 'text', analyzer: 'standard' },
              body: { type: 'text', analyzer: 'standard' },
              status: { type: 'keyword' },
              scheduled_at: { type: 'date' },
              sent_at: { type: 'date' },
              created_at: { type: 'date' },
              failed_reason: { type: 'text' },
            },
          },
        },
      });
      console.log('✓ Elasticsearch index created');
    } else {
      console.log('✓ Elasticsearch index exists');
    }

    // Verify connection
    const health = await client.cluster.health();
    console.log(`✓ Elasticsearch connected (status: ${health.status})`);
  } catch (error) {
    console.error('Error initializing Elasticsearch:', error);
    throw error;
  }
}

/**
 * Index an email document
 */
export async function indexEmail(emailData: {
  id: number;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at?: string;
  created_at: string;
  failed_reason?: string;
}): Promise<void> {
  try {
    await client.index({
      index: INDEX_NAME,
      id: emailData.id.toString(),
      body: emailData,
    });
  } catch (error) {
    console.error('Error indexing email:', error);
    // Don't throw - indexing failure shouldn't block email processing
  }
}

/**
 * Update email status in index
 */
export async function updateEmailStatus(
  emailId: number,
  status: string,
  sentAt?: string
): Promise<void> {
  try {
    await client.update({
      index: INDEX_NAME,
      id: emailId.toString(),
      body: {
        doc: {
          status,
          ...(sentAt && { sent_at: sentAt }),
        },
      },
    });
  } catch (error) {
    console.error('Error updating email status:', error);
  }
}

/**
 * Search emails with query string
 */
export async function searchEmails(query: string, limit = 100): Promise<any[]> {
  try {
    const result = await client.search({
      index: INDEX_NAME,
      body: {
        query: {
          multi_match: {
            query,
            fields: ['subject^2', 'body', 'sender', 'recipient'],
          },
        },
        size: limit,
      },
    });

    return result.hits.hits.map((hit: any) => ({
      ...hit._source,
      _score: hit._score,
    }));
  } catch (error) {
    console.error('Error searching emails:', error);
    return [];
  }
}

/**
 * Advanced search with filters
 */
export async function advancedSearchEmails(
  query: string,
  filters?: {
    sender?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  },
  limit = 100
): Promise<any[]> {
  try {
    const must: any[] = [];

    // Full-text search
    if (query && query.trim().length > 0) {
      must.push({
        multi_match: {
          query,
          fields: ['subject^2', 'body', 'sender', 'recipient'],
        },
      });
    }

    // Sender filter
    if (filters?.sender) {
      must.push({
        match: { sender: filters.sender },
      });
    }

    // Status filter
    if (filters?.status) {
      must.push({
        match: { status: filters.status },
      });
    }

    // Date range
    const dateRange: any = {};
    if (filters?.startDate) {
      dateRange.gte = filters.startDate;
    }
    if (filters?.endDate) {
      dateRange.lte = filters.endDate;
    }
    if (Object.keys(dateRange).length > 0) {
      must.push({
        range: { created_at: dateRange },
      });
    }

    const result = await client.search({
      index: INDEX_NAME,
      body: {
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
          },
        },
        size: limit,
        sort: [{ created_at: 'desc' }],
      },
    });

    return result.hits.hits.map((hit: any) => ({
      ...hit._source,
      _score: hit._score,
    }));
  } catch (error) {
    console.error('Error in advanced search:', error);
    return [];
  }
}

/**
 * Get search statistics
 */
export async function getSearchStats(): Promise<{
  totalEmails: number;
  sent: number;
  failed: number;
  scheduled: number;
}> {
  try {
    const result = await client.search({
      index: INDEX_NAME,
      body: {
        size: 0,
        aggs: {
          status_breakdown: {
            terms: { field: 'status' },
          },
        },
      },
    });

    const stats = {
      totalEmails: result.hits.total.value,
      sent: 0,
      failed: 0,
      scheduled: 0,
    };

    result.aggregations?.status_breakdown.buckets.forEach((bucket: any) => {
      if (bucket.key === 'sent') stats.sent = bucket.doc_count;
      if (bucket.key === 'failed') stats.failed = bucket.doc_count;
      if (bucket.key === 'scheduled') stats.scheduled = bucket.doc_count;
    });

    return stats;
  } catch (error) {
    console.error('Error getting search stats:', error);
    return { totalEmails: 0, sent: 0, failed: 0, scheduled: 0 };
  }
}

export default client;
