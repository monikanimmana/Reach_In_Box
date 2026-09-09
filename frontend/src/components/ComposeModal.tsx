'use client';

import { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { scheduleEmail } from '@/lib/api';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ComposeModal({ isOpen, onClose, onSuccess }: ComposeModalProps) {
  const [formData, setFormData] = useState({
    sender: '',
    subject: '',
    body: '',
    recipients: '',
    scheduledAtDate: '',
    scheduledAtTime: '12:00',
    delayBetweenEmails: 0,
    maxEmailsPerHour: 50,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successCount, setSuccessCount] = useState(0);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'maxEmailsPerHour' || name === 'delayBetweenEmails' ? parseInt(value) || 0 : value,
    }));
  };

  const parseRecipients = (text: string): string[] => {
    return text
      .split(/[\n,;]/)
      .map((email) => email.trim())
      .filter((email) => email.includes('@'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessCount(0);
    setLoading(true);

    try {
      const recipients = parseRecipients(formData.recipients);
      if (recipients.length === 0) {
        throw new Error('No valid email addresses found');
      }

      if (!formData.sender || !formData.subject || !formData.body) {
        throw new Error('Please fill in all required fields');
      }

      if (!formData.scheduledAtDate) {
        throw new Error('Please select a date');
      }

      // Parse scheduled time
      const [hours, minutes] = formData.scheduledAtTime.split(':').map(Number);
      const scheduledDate = new Date(formData.scheduledAtDate);
      scheduledDate.setHours(hours, minutes, 0, 0);
      const scheduledAt = scheduledDate.getTime();

      if (scheduledAt <= Date.now()) {
        throw new Error('Scheduled time must be in the future');
      }

      // Schedule emails
      let successCount = 0;
      for (const recipient of recipients) {
        try {
          await scheduleEmail({
            sender: formData.sender,
            recipient,
            subject: formData.subject,
            body: formData.body,
            scheduledAt,
          });
          successCount++;

          // Delay between scheduling (if configured)
          if (formData.delayBetweenEmails > 0) {
            await new Promise((resolve) => setTimeout(resolve, formData.delayBetweenEmails));
          }
        } catch (err) {
          console.error(`Failed to schedule email to ${recipient}:`, err);
        }
      }

      setSuccessCount(successCount);
      if (successCount === recipients.length) {
        setTimeout(() => {
          onSuccess();
          onClose();
          setFormData({
            sender: '',
            subject: '',
            body: '',
            recipients: '',
            scheduledAtDate: '',
            scheduledAtTime: '12:00',
            delayBetweenEmails: 0,
            maxEmailsPerHour: 50,
          });
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule emails');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const recipients = parseRecipients(formData.recipients);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">Compose New Email</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {successCount > 0 && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
              ✅ {successCount} email(s) scheduled successfully!
            </div>
          )}

          {/* Sender */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From (Sender Email) *
            </label>
            <input
              type="email"
              name="sender"
              value={formData.sender}
              onChange={handleInputChange}
              className="input"
              placeholder="support@company.com"
              required
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject *
            </label>
            <input
              type="text"
              name="subject"
              value={formData.subject}
              onChange={handleInputChange}
              className="input"
              placeholder="Email subject"
              required
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Body / Message *
            </label>
            <textarea
              name="body"
              value={formData.body}
              onChange={handleInputChange}
              className="input min-h-[150px] resize-none"
              placeholder="Email body text (HTML supported)"
              required
            />
          </div>

          {/* Recipients */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recipients (CSV or one per line) *
            </label>
            <textarea
              name="recipients"
              value={formData.recipients}
              onChange={handleInputChange}
              className="input min-h-[100px] resize-none font-mono text-sm"
              placeholder="user1@example.com, user2@example.com"
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              Detected: <strong>{recipients.length}</strong> email address(es)
            </p>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date *
              </label>
              <input
                type="date"
                name="scheduledAtDate"
                value={formData.scheduledAtDate}
                onChange={handleInputChange}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Time *
              </label>
              <input
                type="time"
                name="scheduledAtTime"
                value={formData.scheduledAtTime}
                onChange={handleInputChange}
                className="input"
                required
              />
            </div>
          </div>

          {/* Delay Between Emails */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Delay Between Sends (ms)
            </label>
            <input
              type="number"
              name="delayBetweenEmails"
              value={formData.delayBetweenEmails}
              onChange={handleInputChange}
              className="input"
              placeholder="0"
              min="0"
            />
            <p className="text-sm text-gray-500 mt-1">Optional: delay between scheduling each email</p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || recipients.length === 0}
              className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Scheduling...' : `Schedule ${recipients.length} Email(s)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
