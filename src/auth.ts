import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    login?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      // `repo` is needed to create and write the private vault repository.
      authorization: { params: { scope: "read:user user:email repo" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile?.login) token.login = profile.login as string;
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.login = token.login as string | undefined;
      return session;
    },
  },
  pages: { signIn: "/" },
});
