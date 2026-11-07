import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "@/components/language/LanguageProvider";
import type { BranchMindLanguage } from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";

/** English UI copy; use it to query by the same labels the components render. */
export const copy = LANGUAGE_COPY.en;

type RenderWithProvidersOptions = Omit<RenderOptions, "wrapper"> & {
  /** UI language for `useLanguage()`. Defaults to English. */
  language?: BranchMindLanguage;
  /** Extra wrapper rendered inside the app providers (e.g. `ReactFlowProvider`). */
  wrapper?: (props: { children: ReactNode }) => ReactElement;
};

/**
 * Renders `ui` inside the providers BranchMind components expect and returns a
 * `user` (Testing Library user-event) bound to the same document.
 */
export function renderWithProviders(
  ui: ReactElement,
  { language = "en", wrapper: InnerWrapper, ...options }: RenderWithProvidersOptions = {},
) {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <LanguageProvider initialLanguage={language}>
        {InnerWrapper ? <InnerWrapper>{children}</InnerWrapper> : children}
      </LanguageProvider>
    );
  }

  const user = userEvent.setup();
  return { user, ...render(ui, { wrapper: Providers, ...options }) };
}

/** JSON `Response` helper for `fetch` mocks. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
