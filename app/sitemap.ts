import type { MetadataRoute } from "next";

const appOrigin = (process.env.APP_ORIGIN ?? "https://branchmind.app").replace(/\/+$/, "");

const publicRoutes: Array<{ path: string; priority: number }> = [
  { path: "", priority: 1 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/auth/sign-in", priority: 0.6 },
  { path: "/auth/sign-up", priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return publicRoutes.map(({ path, priority }) => ({
    url: `${appOrigin}${path}`,
    lastModified,
    changeFrequency: "monthly",
    priority,
  }));
}
