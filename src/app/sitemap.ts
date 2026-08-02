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
        `${origin}/asher-hero-clinic.png`,
        `${origin}/asher-abstract-care.png`,
      ],
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
