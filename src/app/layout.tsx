import "./globals.css";

export const metadata = {
  title: "RECHNO | سرمایه‌گذاری هوشمند",
  description: "سامانه سرمایه‌گذاری RECHNO",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
