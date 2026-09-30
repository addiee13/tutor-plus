import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Tutor Plus — Your next chapter", template: "%s | Tutor Plus" }, description: "Structured learning coordination for adult students and tutors. Start with a verified account and a profile that feels like you." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
