import { ArrowLeft, Brain, FileText } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { PdfReader } from "@/components/rag/PdfReader";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";

export default function ReaderPage() {
  return (
    <main
      aria-labelledby="reader-title"
      data-testid="reader-page"
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <ResponsiveHeader
          title="PDF Reader"
          titleId="reader-title"
          titleAs="h1"
          icon={<FileText size={22} />}
          navLabel="Reader navigation"
          actions={<AuthPanel />}
          links={[
            { href: "/", label: "Home", icon: <ArrowLeft size={18} /> },
            { href: "/projects", label: "Projects", icon: <Brain size={17} /> },
          ]}
        />

        <PdfReader />
      </div>
    </main>
  );
}
