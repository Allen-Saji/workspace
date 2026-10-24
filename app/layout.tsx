import {brandMetadata} from '../src/server/metadata';
import './globals.css';
export const metadata=brandMetadata();
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
