import { ImageResponse } from "next/og";

export const alt =
  "BranchMind — 可视化分支式 AI 对话工作区 · A visual branching AI conversation workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

// next/og only bundles a Latin font, so the Chinese tagline needs a CJK font
// fetched at request time. If the fetch fails, the image falls back to
// English-only text instead of rendering missing glyphs.
const NOTO_SANS_SC_URL =
  "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCrYtHaA.ttf";

async function loadChineseFont(): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(NOTO_SANS_SC_URL, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const fontData = await loadChineseFont();
  const fontFamily = fontData ? "Noto Sans SC" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 88px",
          background: "linear-gradient(135deg, #1b5e3b 0%, #2d7a4f 48%, #5bc68a 100%)",
          fontFamily,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -140,
            right: -140,
            width: 420,
            height: 420,
            borderRadius: 9999,
            background: "rgba(168, 230, 207, 0.22)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -180,
            right: 140,
            width: 340,
            height: 340,
            borderRadius: 9999,
            background: "rgba(168, 230, 207, 0.14)",
            display: "flex",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.32em",
            color: "#a8e6cf",
          }}
        >
          BRANCHMIND
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 18,
            fontSize: 112,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#ffffff",
            lineHeight: 1.05,
          }}
        >
          BranchMind
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 34,
            width: 96,
            height: 6,
            borderRadius: 9999,
            background: "#a8e6cf",
          }}
        />
        {fontData ? (
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 44,
              fontWeight: 700,
              color: "#e9f7ef",
            }}
          >
            可视化分支式 AI 对话工作区
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            marginTop: fontData ? 12 : 28,
            fontSize: 32,
            color: "#a8e6cf",
          }}
        >
          A visual branching AI conversation workspace
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontData
        ? [
            {
              name: "Noto Sans SC",
              data: fontData,
              weight: 700 as const,
              style: "normal" as const,
            },
          ]
        : undefined,
    }
  );
}
