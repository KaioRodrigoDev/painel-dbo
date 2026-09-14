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
  return origin === new URL(request.url).origin;
}

export async function authorizeApiRequest(request: Request, mutation = false) {
  if (!(await isAdminAuthenticated())) return false;
  if (mutation && !hasSameOrigin(request)) return false;
  return true;
}
