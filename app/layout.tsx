import type { Metadata } from 'next';
import './globals-fixed.css';

export const metadata: Metadata = {
  title: 'Order to Cash — Graph Intelligence',
  description: 'Explore and query your Order-to-Cash data through an interactive knowledge graph',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
