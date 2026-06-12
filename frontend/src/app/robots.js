export default function robots() {
  return {
    rules: [
      // Public marketing pages are open to all crawlers, including AI bots
      // (GPTBot, ClaudeBot, PerplexityBot etc. follow the wildcard rule).
      { userAgent: '*', allow: ['/', '/landing'], disallow: ['/api/', '/dashboard'] },
    ],
    sitemap: 'https://pumpini.in/sitemap.xml',
  };
}
