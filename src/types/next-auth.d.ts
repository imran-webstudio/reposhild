import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      login?: string;
      githubId?: string;
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    login?: string;
    githubId?: string;
    expiresAt?: number;
  }
}
