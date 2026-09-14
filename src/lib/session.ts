import "server-only";

import { cookies } from "next/headers";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import { getAdminConfig } from "@/lib/env";

const COOKIE_NAME = "dbow_admin_session";
const SESSION_SECONDS = 60 * 60 * 8;

type AdminSession = JWTPayload & {
  role: "admin";
  username: string;
};

function encodedSecret() {
  return new TextEncoder().encode(getAdminConfig().sessionSecret);
}

export async function createAdminSession(username: string) {
  const token = await new SignJWT({ role: "admin", username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(encodedSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: getAdminConfig().secureCookie,
    sameSite: "strict",
    maxAge: SESSION_SECONDS,
    path: "/",
    priority: "high",
  });
}

export async function deleteAdminSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, encodedSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.role !== "admin" || typeof payload.username !== "string") {
      return null;
    }
    return payload as AdminSession;
  } catch {
    return null;
  }
}

export async function isAdminAuthenticated() {
  return (await getAdminSession()) !== null;
}
