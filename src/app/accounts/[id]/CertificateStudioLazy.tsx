"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const Studio = dynamic(
  () =>
    import("./CertificateStudio").then((m) => m.CertificateStudio),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-[var(--muted)]">Loading Certificate Studio…</p>
    ),
  },
);

type StudioProps = ComponentProps<typeof Studio>;

/** Defers the 3.4k-line studio until the certificates tab needs it. */
export function CertificateStudioLazy(props: StudioProps) {
  return <Studio {...props} />;
}
