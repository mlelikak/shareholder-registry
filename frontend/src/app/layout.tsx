import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/app/ui';

export const metadata: Metadata = {
  title: 'Shareholder Registry',
  description: 'Exit-day payouts: verified shareholders, a caretaker agent that cannot move money, and provably correct payouts.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner">Demo on NEAR testnet · test euros, not real money · logins, emails and texts are simulated</div>
        <Nav />
        {children}
      </body>
    </html>
  );
}
