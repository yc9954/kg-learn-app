import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";

const entraClientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
const entraClientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
const entraIssuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;

const providers = [];

if (entraClientId && entraClientSecret && entraIssuer) {
  providers.push(
    AzureADProvider({
      clientId: entraClientId,
      clientSecret: entraClientSecret,
      issuer: entraIssuer,
    }),
  );
}

if (process.env.NODE_ENV !== "production" && providers.length === 0) {
  providers.push(
    CredentialsProvider({
      name: "Dev Login",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "dev@kg-learn.local" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim() || "dev@kg-learn.local";
        return { id: email, email, name: "Dev User" };
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      await prisma.user.upsert({
        where: { email: user.email },
        create: { email: user.email, name: user.name ?? user.email },
        update: { name: user.name ?? undefined, image: user.image ?? undefined },
      });
      return true;
    },
    async jwt({ token }) {
      if (token.email) {
        const row = await prisma.user.findUnique({
          where: { email: token.email },
          select: { id: true },
        });
        if (row) token.sub = row.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
