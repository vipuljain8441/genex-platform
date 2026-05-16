import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GenEx — Real assessments. Real signal.",
  description:
    "Drop candidates into a realistic day-1 simulation. Multi-agent assessments by SkillBrew.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative min-h-screen overflow-x-hidden antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
