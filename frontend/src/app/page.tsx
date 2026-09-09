'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import ComposeModal from '@/components/ComposeModal';
import EmailTable from '@/components/EmailTable';
import { getScheduledEmails, getSentEmails, Email } from '@/lib/api';
import { Mail, Send } from 'lucide-react';

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [composing, setComposing] = useState(false);
  const [scheduledEmails, setScheduledEmails] = useState<Email[]>([]);
  const [sentEmails, setSentEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  // Fetch emails
  const fetchEmails = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [scheduled, sent] = await Promise.all([getScheduledEmails(), getSentEmails()]);
      setScheduledEmails(scheduled);
      setSentEmails(sent);
    } catch (error) {
      console.error('Failed to fetch emails:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial fetch and auto-refresh
  useEffect(() => {
    if (session?.user) {
      fetchEmails();
      const interval = setInterval(() => fetchEmails(true), 5000); // Refresh every 5s
      return () => clearInterval(interval);
    }
  }, [session]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  const currentEmails = tab === 'scheduled' ? scheduledEmails : sentEmails;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Title & Actions */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Email Dashboard</h2>
          <button
            onClick={() => setComposing(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Mail className="w-5 h-5" />
            Compose Email
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-200">
          <button
            onClick={() => setTab('scheduled')}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              tab === 'scheduled'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Scheduled ({scheduledEmails.length})
            </div>
          </button>
          <button
            onClick={() => setTab('sent')}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              tab === 'sent'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Sent & Failed ({sentEmails.length})
            </div>
          </button>
        </div>

        {/* Refresh Button */}
        <div className="mb-4">
          <button
            onClick={() => fetchEmails(true)}
            disabled={refreshing}
            className="text-sm px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Table */}
        <EmailTable
          emails={currentEmails}
          loading={loading && !refreshing}
          type={tab}
        />
      </main>

      {/* Compose Modal */}
      <ComposeModal
        isOpen={composing}
        onClose={() => setComposing(false)}
        onSuccess={() => fetchEmails()}
      />
    </div>
  );
}
