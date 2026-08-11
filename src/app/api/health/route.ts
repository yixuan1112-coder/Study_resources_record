import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Configuration diagnostics. Auth.js only ever says "there is a problem with
 * the server configuration", which is not actionable, so this reports which
 * settings are present and what the underlying error actually was.
 *
 * Deliberately reports presence and shape only — never a value.
 */
export async function GET() {
  const shape = (name: string) => {
    const value = process.env[name];
    if (value === undefined) return "unset";
    if (value === "") return "empty";
    if (value !== value.trim()) return "set (has leading/trailing whitespace)";
    return "set";
  };

  let authError: { name: string; message: string } | null = null;
  try {
    await auth();
  } catch (e) {
    authError =
      e instanceof Error
        ? { name: e.name, message: e.message }
        : { name: "Unknown", message: String(e) };
  }

  return NextResponse.json(
    {
      env: {
        AUTH_SECRET: shape("AUTH_SECRET"),
        AUTH_GITHUB_ID: shape("AUTH_GITHUB_ID"),
        AUTH_GITHUB_SECRET: shape("AUTH_GITHUB_SECRET"),
        AUTH_URL: shape("AUTH_URL"),
        AUTH_TRUST_HOST: shape("AUTH_TRUST_HOST"),
        NEXTAUTH_URL: shape("NEXTAUTH_URL"),
      },
      platform: {
        vercel: !!process.env.VERCEL,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        vercelUrl: process.env.VERCEL_URL ?? null,
      },
      authError,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
