import type { Viewport } from "next";
import { brandMetadata } from "../src/server/metadata";
import "./globals.css";
import "./arcade.css";
export const metadata = brandMetadata();
export const viewport: Viewport = {
  themeColor: "#6542e8",
  colorScheme: "light",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
