import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Google_Sans, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

/** Condensed display face for the wordmark, giant numerals and colour-block headlines. */
const display = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
  // No metric overrides exist for this family; use a condensed system fallback instead.
  adjustFontFallback: false,
  fallback: ["Arial Narrow", "Impact", "sans-serif"],
});

/** Editorial serif for page headings and taglines. */
const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});

/** Calm sans for interface text and body copy. */
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/** Google's sign-in guidelines require Google Sans Medium on the provider buttons; only used there. */
const googleSans = Google_Sans({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-google",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Tutor Plus — Your next chapter", template: "%s | Tutor Plus" },
  description:
    "Structured learning coordination for adult students and tutors. Find a tutor, reserve a time, and plan every session in one shared workspace.",
};

export const viewport: Viewport = {
  themeColor: "#1d4a36",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${googleSans.variable}`}
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
