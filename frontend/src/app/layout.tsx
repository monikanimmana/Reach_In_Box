import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'ReachInbox - Email Scheduler',
  description: 'Schedule and manage bulk emails with rate limiting',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
