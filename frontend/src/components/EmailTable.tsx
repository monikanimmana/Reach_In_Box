'use client';

import { Email } from '@/lib/api';
import { Clock, CheckCircle, AlertCircle } from 'lucide-react';

interface EmailTableProps {
  emails: Email[];
  loading: boolean;
  type: 'scheduled' | 'sent';
}

export default function EmailTable({ emails, loading, type }: EmailTableProps) {
  if (loading) {
    return (
      <div className="card text-center py-12">
        <div className="inline-block">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
        <p className="mt-4 text-gray-600">Loading {type} emails...</p>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-4">📭</div>
        <p className="text-gray-600">
          No {type} emails yet. {type === 'scheduled' && 'Use "Compose" to schedule your first email.'}
        </p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'scheduled':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
            <Clock className="w-4 h-4" />
            Scheduled
          </span>
        );
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            <CheckCircle className="w-4 h-4" />
            Sent
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            Failed
          </span>
        );
      default:
        return <span className="text-gray-500">{status}</span>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-6 py-3 text-left font-medium text-gray-700">From</th>
              <th className="px-6 py-3 text-left font-medium text-gray-700">To</th>
              <th className="px-6 py-3 text-left font-medium text-gray-700">Subject</th>
              <th className="px-6 py-3 text-left font-medium text-gray-700">Status</th>
              <th className="px-6 py-3 text-left font-medium text-gray-700">
                {type === 'scheduled' ? 'Scheduled At' : 'Sent At'}
              </th>
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => (
              <tr
                key={email.id}
                className="border-b border-gray-200 hover:bg-gray-50 transition"
              >
                <td className="px-6 py-4 text-gray-900 font-medium">{email.sender}</td>
                <td className="px-6 py-4 text-gray-700">{email.recipient}</td>
                <td className="px-6 py-4 text-gray-700 truncate max-w-xs" title={email.subject}>
                  {email.subject}
                </td>
                <td className="px-6 py-4">{getStatusBadge(email.status)}</td>
                <td className="px-6 py-4 text-gray-600 text-xs">
                  {type === 'scheduled'
                    ? formatDate(email.scheduled_at)
                    : email.sent_at
                    ? formatDate(email.sent_at)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
