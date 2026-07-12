export default function sitemap() {
  // Only canonical URLs belong in the sitemap. The public landing page is now
  // served directly at the root, and /landing canonicalises to the root — so we
  // list the root alone and avoid pointing crawlers at a duplicate URL.
  return [
    { url: 'https://pumpini.in', lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
  ];
}
