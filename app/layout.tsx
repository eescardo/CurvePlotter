import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Curve Plotter",
  description: "Draw and edit 2D lines and Bezier curves on a grid."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
