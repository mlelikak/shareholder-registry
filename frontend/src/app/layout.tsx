import '@/app/globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Nav } from '@/app/ui';
import { InboxDock } from '@/app/inbox-dock';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mnemon Payment Agent',
  description: 'Exit-day payouts: verified shareholders, a caretaker agent that cannot move money, and provably correct payouts.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="demo-strip">
          <b>Demo</b> on NEAR testnet · test euros, not real money · logins, emails and texts are simulated
        </div>
        <Nav />
        {children}
        <InboxDock />
      </body>
    </html>
  );
}
