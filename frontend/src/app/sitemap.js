export default function sitemap() {
  return [
    { url: 'https://pumpini.in', lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: 'https://pumpini.in/landing', lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
  ];
}
