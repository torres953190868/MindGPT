import { describe, expect, it } from "vitest";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import {
  buildFaqPageJsonLd,
  buildSoftwareApplicationJsonLd,
} from "@/lib/help-structured-data";

describe("help structured data", () => {
  it("describes BranchMind as a free educational web application", () => {
    const data = buildSoftwareApplicationJsonLd("https://branchmind.app");

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "BranchMind",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      url: "https://branchmind.app",
    });
  });

  it("mirrors the visible help FAQ in both languages", () => {
    for (const language of ["zh", "en"] as const) {
      const faq = LANGUAGE_COPY[language].help.faq;
      const data = buildFaqPageJsonLd(faq);

      expect(data["@type"]).toBe("FAQPage");
      expect(data.mainEntity).toHaveLength(faq.length);
      data.mainEntity.forEach((entity, index) => {
        expect(entity.name).toBe(faq[index].question);
        expect(entity.acceptedAnswer.text).toBe(faq[index].answer);
      });
    }
  });
});
