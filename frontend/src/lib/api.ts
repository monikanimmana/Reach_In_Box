import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Email {
  id: number;
  sender: string;
  recipient: string;
  subject: string;
  body?: string;
  status: 'scheduled' | 'sent' | 'failed';
  scheduled_at: string;
  sent_at?: string;
  created_at: string;
  failed_reason?: string;
}

export interface RateLimit {
  hourKey: string;
  currentCount: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  resetAt: string;
}

export interface ScheduleEmailRequest {
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: number;
}

export interface ScheduleEmailResponse {
  success: boolean;
  emailId: number;
  message: string;
  rateLimit: RateLimit;
}

// Schedule a new email
export async function scheduleEmail(data: ScheduleEmailRequest): Promise<ScheduleEmailResponse> {
  const response = await api.post('/api/emails', data);
  return response.data;
}

// Get scheduled emails
export async function getScheduledEmails(): Promise<Email[]> {
  const response = await api.get('/api/emails?status=scheduled');
  return response.data.emails;
}

// Get sent emails
export async function getSentEmails(): Promise<Email[]> {
  const response = await api.get('/api/emails/sent');
  return response.data.emails;
}

// Get rate limit status
export async function getRateLimitStatus(sender: string): Promise<RateLimit> {
  const response = await api.get(`/api/rate-limit/${encodeURIComponent(sender)}`);
  return response.data.rateLimit;
}

export default api;
