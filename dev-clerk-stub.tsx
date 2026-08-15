/**
 * LOCAL ONLY — never imported by the app. Aliased over @clerk/nextjs by
 * next.config.ts when DEV_NO_AUTH=1, so the desk can be rendered on a
 * machine that has no Clerk publishable key.
 */
import type { ReactNode } from "react";

export const ClerkProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const Show = ({ when, children }: { when?: string; children?: ReactNode }) =>
  when === "signed-out" ? null : <>{children}</>;
export const SignInButton = ({ children }: { children?: ReactNode; mode?: string }) => <>{children}</>;
export const SignUpButton = ({ children }: { children?: ReactNode; mode?: string }) => <>{children}</>;
export const UserButton = (_props?: Record<string, unknown>) => (
  <div className="h-7 w-7 rounded-full bg-[#1b2a5e]" />
);
export const SignIn = () => <div />;
export const SignUp = () => <div />;
export const useUser = () => ({ isSignedIn: true, user: { firstName: "Desk" } });
export const useAuth = () => ({ isSignedIn: true, userId: "dev" });
