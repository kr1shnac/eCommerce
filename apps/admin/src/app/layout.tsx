import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kunigal Admin',
  description: 'Shop admin panel for Kunigal Grocery',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}