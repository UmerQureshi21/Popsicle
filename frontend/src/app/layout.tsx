import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import Nav from "@/components/Nav";
import { ThemeSync } from "@/components/Theme";
import { NO_FLASH_SCRIPT } from "@/lib/themeScript";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Popsicle",
  description: "Cold email to coffee chat: personal emails from your Gmail, every reply in one place, and Google Meet in one click",
};

// "cover" lets the phone tab bar sit flush with the bottom edge, padded by the safe-area inset.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme is set on <html> by the script below before React starts, hence suppressHydrationWarning.
    <html lang="en" className={`${montserrat.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeSync />
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
