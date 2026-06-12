import './globals.css';
import Providers from '../components/shared/Providers';

export const metadata = {
  metadataBase: new URL('https://pumpini.in'),
  title: {
    default: 'Pumpini — AI-Powered Petrol Pump Management Software',
    template: '%s · Pumpini',
  },
  description:
    'Pumpini is AI-powered petrol pump (bunk) management software for India — ' +
    'billing & GST invoices, tank stock & dip reconciliation, shift cash control, ' +
    'credit customers and live dashboards, in 6 Indian languages. ' +
    'Presents the today, predicts the tomorrow.',
  keywords: [
    'petrol pump management software', 'petrol pump software India',
    'petrol bunk software', 'petrol pump accounting software',
    'fuel station billing software', 'petrol pump cash reconciliation',
    'tank stock dip software', 'petrol pump software price',
    'AI petrol pump software',
  ],
  manifest: '/manifest.json',
  themeColor: '#0C2418',
  openGraph: {
    type: 'website',
    url: 'https://pumpini.in',
    siteName: 'Pumpini',
    title: 'Pumpini — Presents the TODAY. Predicts the TOMORROW.',
    description:
      'AI-powered petrol bunk management — fuel, cash and credit watched 24×7, ' +
      'in 6 Indian languages. 15-day free trial.',
    images: [{ url: '/og-card.png', width: 1200, height: 630, alt: 'Pumpini — AI-powered petrol bunk management' }],
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pumpini — Presents the TODAY. Predicts the TOMORROW.',
    description: 'AI-powered petrol bunk management — fuel, cash and credit watched 24×7, in 6 Indian languages.',
    images: ['/og-card.png'],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://pumpini.in' },
};

// Machine-readable facts for search engines and AI assistants.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://pumpini.in/#org',
      name: 'Pumpini',
      url: 'https://pumpini.in',
      logo: 'https://pumpini.in/pumpini-logo.png',
      slogan: 'Control every drop. Track every rupee.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Pumpini',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android (PWA), iOS (PWA)',
      url: 'https://pumpini.in',
      description:
        'AI-powered petrol pump (bunk) management software for India: billing & GST invoices, ' +
        'wet-stock (tank dip) reconciliation, blind-drop shift cash control, credit customers & ' +
        'corporate fleet portal, lubes & products with barcode, voice POS entry, geo-fenced POS, ' +
        'real-time owner dashboard, Tally export, and an AI assistant that answers questions about ' +
        'your own bunk data and flags patterns in stock loss, cash shortage, evaporation and credit risk.',
      inLanguage: ['en', 'hi', 'ta', 'te', 'kn', 'mr'],
      publisher: { '@id': 'https://pumpini.in/#org' },
      offers: [
        { '@type': 'Offer', name: 'Starter', price: '599', priceCurrency: 'INR',
          description: '₹599/month per station — billing, tank & cash reconciliation, live dashboard. 15-day free trial.' },
        { '@type': 'Offer', name: 'Pro', price: '999', priceCurrency: 'INR',
          description: '₹999/month per station — adds credit customers, lubes & products, Tally export, AI assistant. 15-day free trial.' },
        { '@type': 'Offer', name: 'Enterprise', price: '1999', priceCurrency: 'INR',
          description: '₹1999/month — up to 5 stations with group dashboard and corporate fleet portal. 15-day free trial.' },
      ],
      featureList: 'Voice POS in 6 Indian languages, Blind-drop cash control, Wet & dry stock reconciliation, GST billing, Credit & corporate portal, GPS geo-fencing, Real-time dashboard, AI assistant & pattern alerts',
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true"/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <script type="application/ld+json" suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
