"use client";

import { Show } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { MiddleBroBot } from "@/components/MiddleBroBot";
import { OperatorInbox } from "@/components/OperatorInbox";

const PUBLIC_AUTH_ROUTE = /^\/(?:sign-(?:in|up)(?:\/.*)?|access-denied)$/;

/** Desk-only floating tools; never render on login or denied-access screens. */
export function AuthenticatedDeskWidgets() {
  const pathname = usePathname();
  if (PUBLIC_AUTH_ROUTE.test(pathname)) return null;

  return (
    <Show when="signed-in">
      <OperatorInbox />
      <MiddleBroBot />
    </Show>
  );
}
