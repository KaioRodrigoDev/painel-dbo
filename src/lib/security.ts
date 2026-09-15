import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getAdminConfig } from "@/lib/env";
import { isAdminAuthenticated } from "@/lib/session";

export function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function validateAdminCredentials(username: string, password: string) {
  const config = getAdminConfig();
  return (
    constantTimeEqual(username, config.username) &&
    constantTimeEqual(password, config.password)
  );
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  if (normalizedOrigin !== origin) return false;

  const requestUrl = new URL(request.url);
  const acceptedOrigins = new Set([requestUrl.origin]);
  const forwardedHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))
    ?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (
    forwardedHost &&
    !/[\s/\\]/.test(forwardedHost) &&
    (forwardedProto === "http" || forwardedProto === "https")
  ) {
    try {
      acceptedOrigins.add(new URL(`${forwardedProto}://${forwardedHost}`).origin);
    } catch {
      return false;
    }
  }

  return acceptedOrigins.has(normalizedOrigin);
}

export async function authorizeApiRequest(request: Request, mutation = false) {
  if (!(await isAdminAuthenticated())) return false;
  if (mutation && !hasSameOrigin(request)) return false;
  return true;
}
