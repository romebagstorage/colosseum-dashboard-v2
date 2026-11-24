import './globals.css';
import { Playfair_Display, Roboto } from 'next/font/google';
import { BRAND } from '@/config/brand';

const display = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });
const sans = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans', display: 'swap' });

export const metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: `${BRAND.tagline} ${BRAND.name} (dati Guesty)`,
};

export default function RootLayout({ children }) {
  const c = BRAND.colors;
  const vars = `:root{--brand:${c.brand};--brand-dark:${c.brandDark};--accent:${c.accent};--accent-text:${c.accentText};--bg:${c.pageBg};--raised:${c.raised};--panel:${c.surface};--text:${c.ink};--text-dim:${c.inkMuted};--text-subtle:${c.inkSubtle};--green:${c.success};--red:${c.danger};--yellow:${c.warning};--info:${c.info};}`;
  return (
    <html lang="it" className={`${display.variable} ${sans.variable}`}>
      <head><style dangerouslySetInnerHTML={{ __html: vars }} /></head>
      <body>{children}</body>
    </html>
  );
}
