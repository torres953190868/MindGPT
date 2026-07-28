import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PDF Reader",
  description:
    "上传可选中文本的 PDF，建立索引并提出带页码引用的问题。Upload a selectable-text PDF and ask grounded questions with page citations.",
  alternates: { canonical: "/reader" },
};

export default function ReaderLayout({ children }: { children: ReactNode }) {
  return children;
}
