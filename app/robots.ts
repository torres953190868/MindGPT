import type { MetadataRoute } from "next";

const appOrigin = (process.env.APP_ORIGIN ?? "https://branchmind.app").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/workspace", "/projects", "/settings", "/admin", "/api"],
    },
    sitemap: `${appOrigin}/sitemap.xml`,
  };
}
