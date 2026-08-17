/** LOCAL ONLY — aliased over @clerk/nextjs/server when DEV_NO_AUTH=1. */
export const clerkClient = async () => ({
  users: {
    getUser: async () => ({
      primaryEmailAddress: {
        emailAddress: "dev@harperinsure.com",
        verification: { status: "verified" },
      },
    }),
  },
});
export const clerkMiddleware = () => () => undefined;
export const auth = async () => ({ isAuthenticated: false, userId: null });
export const currentUser = async () => null;
export const createRouteMatcher = () => () => false;
