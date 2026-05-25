import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_CITATIONS,
  getChatCitationMarkerIndexes,
  normalizeChatCitations,
  replaceChatCitationMarkers,
} from "@/lib/chat-citations";

describe("chat citation normalization", () => {
  it("sanitizes citations and normalizes reversed page ranges", () => {
    const citations = normalizeChatCitations([
      {
        index: 1,
        documentId: "  document-1  ",
        documentName: "  source.pdf  ",
        chunkId: "  chunk-1  ",
        pageStart: 9,
        pageEnd: 4,
        headingPath: ["  Chapter 1  ", "", 42, "Evidence"],
        quote: "  Important quoted context.  ",
      },
      {
        index: 0,
        documentId: "document-2",
        documentName: "source.pdf",
        chunkId: "chunk-2",
        pageStart: 1,
        pageEnd: 1,
        quote: "Invalid because index is not positive.",
      },
      "not a citation",
    ]);

    expect(citations).toEqual([
      {
        index: 1,
        documentId: "document-1",
        documentName: "source.pdf",
        chunkId: "chunk-1",
        pageStart: 4,
        pageEnd: 9,
        headingPath: ["Chapter 1", "Evidence"],
        quote: "Important quoted context.",
      },
    ]);
  });

  it("limits normalized citations to the supported chat payload size", () => {
    const citations = normalizeChatCitations(
      Array.from({ length: MAX_CHAT_CITATIONS + 2 }, (_, index) => ({
        index: index + 1,
        documentId: `document-${index + 1}`,
        documentName: "source.pdf",
        chunkId: `chunk-${index + 1}`,
        pageStart: 1,
        pageEnd: 1,
        headingPath: [],
        quote: `Quote ${index + 1}`,
      })),
    );

    expect(citations).toHaveLength(MAX_CHAT_CITATIONS);
    expect(citations.at(-1)?.index).toBe(MAX_CHAT_CITATIONS);
  });
});

describe("chat citation markers", () => {
  it("replaces supported marker formats while preserving the original marker text", () => {
    const content =
      "Alpha [[cite:2]], beta [ cite : 3 ], gamma [[ CITE : 4 ]].";

    const replaced = replaceChatCitationMarkers(
      content,
      (index, marker) => `<sup data-index="${index}">${marker}</sup>`,
    );

    expect(replaced).toBe(
      'Alpha <sup data-index="2">[[cite:2]]</sup>, beta <sup data-index="3">[ cite : 3 ]</sup>, gamma <sup data-index="4">[[ CITE : 4 ]]</sup>.',
    );
  });

  it("collects unique marker indexes from answer content", () => {
    expect([...getChatCitationMarkerIndexes("[[cite:1]] [cite:2] [[cite:1]]")]).toEqual([
      1,
      2,
    ]);
  });
});
