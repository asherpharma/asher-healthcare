import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const origin = "https://asherhealthcare.in";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: origin,
      changeFrequency: "weekly",
      priority: 1,
      images: [
        `${origin}/asher-hero-clinic-v2.webp`,
        `${origin}/images/pediatric-care-consultation-v2.webp`,
        `${origin}/images/womens-care-consultation-v2.webp`,
      ],
    },
    {
      url: `${origin}/care/pediatrics`,
      changeFrequency: "monthly",
      priority: 0.8,
      images: [`${origin}/images/pediatric-care-consultation-v2.webp`],
    },
    {
      url: `${origin}/care/womens-health`,
      changeFrequency: "monthly",
      priority: 0.8,
      images: [`${origin}/images/womens-care-consultation-v2.webp`],
    },
    {
      url: `${origin}/patient-rights`,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${origin}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${origin}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
