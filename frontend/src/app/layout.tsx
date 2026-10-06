import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import Nav from "@/components/Nav";
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
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
