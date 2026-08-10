import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admind · Director Dashboard",
  description:
    "Operational KPI dashboard for Admind's Creative, Strategy, and CT Directors.",
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
