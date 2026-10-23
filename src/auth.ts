import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const secret =
  process.env.AUTH_SECRET || (process.env.NODE_ENV === "production" ? undefined : "reposhild-local-dev-secret");

const githubId = process.env.AUTH_GITHUB_ID;
const githubSecret = process.env.AUTH_GITHUB_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret,
  trustHost: true,
  session: { strategy: "jwt" },
  providers:
    githubId && githubSecret
      ? [
          GitHub({
            clientId: githubId,
            clientSecret: githubSecret,
            // GitHub appends iss=https://github.com/login/oauth to the callback (RFC 9207).
            // Auth.js otherwise compares that value with https://authjs.dev and rejects the login.
            issuer: "https://github.com/login/oauth",
            authorization: {
              params: { scope: "repo read:org" },
            },
          }),
        ]
      : [],
  callbacks: {
    jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (typeof account?.expires_at === "number") token.expiresAt = account.expires_at;
      if (profile && typeof profile === "object" && "login" in profile && typeof profile.login === "string") {
        token.login = profile.login;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.login === "string") {
        session.user.login = token.login;
      }
      return session;
    },
  },
});
