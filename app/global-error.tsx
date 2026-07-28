"use client";

import { useEffect } from "react";
import Link from "next/link";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Global errors replace the root layout, so theme CSS may not be loaded here.
// Inline styles keep this fallback readable in every failure mode.
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f7f3ec",
          color: "#29252f",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          padding: "32px 16px",
          boxSizing: "border-box",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: "#ffffff",
            border: "1px solid #ece5da",
            borderRadius: 24,
            boxShadow: "0 24px 60px rgba(41, 37, 47, 0.12)",
            padding: "36px 28px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 44,
              fontWeight: 900,
              letterSpacing: "-0.02em",
              color: "#2d7a4f",
            }}
          >
            出错了
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: 20, fontWeight: 800 }}>
            应用发生严重错误
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 600, color: "#8f8172" }}>
            Something went wrong
          </p>
          <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.7, color: "#515f5a" }}>
            请重试一次；如果问题持续出现，请稍后再回来。
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.6, color: "#8f8172" }}>
            An unexpected error occurred. Please try again in a moment.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: "12px 0 0",
                padding: "8px 12px",
                borderRadius: 12,
                backgroundColor: "#f7f3ec",
                fontSize: 12,
                color: "#8f8172",
              }}
            >
              错误编号 Error digest：{error.digest}
            </p>
          ) : null}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                padding: "10px 20px",
                borderRadius: 18,
                border: "none",
                backgroundColor: "#2d7a4f",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              重试 Try again
            </button>
            <Link
              href="/"
              style={{
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                padding: "10px 20px",
                borderRadius: 18,
                border: "1px solid #d8ccb9",
                backgroundColor: "#ffffff",
                color: "#29252f",
                fontSize: 14,
                fontWeight: 800,
                textDecoration: "none",
                boxSizing: "border-box",
              }}
            >
              返回首页 Back to home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
