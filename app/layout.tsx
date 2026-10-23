import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Workspace — a little space for your day', description: 'Your day, learning, and reported context in one calm place.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
