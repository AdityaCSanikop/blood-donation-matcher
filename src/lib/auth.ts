/**
 * Authentication and role checks.
 *  - Passwords: bcrypt hashes only (never stored or logged in plain text).
 *  - Session: signed JWT (HS256) in an httpOnly, SameSite=Lax cookie.
 *  - Two roles: STAFF (hospital staff) and DONOR.
 */
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { env } from "./env";
import { AppError, forbidden } from "./errors";
import type { Role } from "./constants";

export const SESSION_COOKIE = "bdm_session";
const SESSION_HOURS = 8;

export type SessionUser = {
  user_id: number;
  email: string;
  display_name: string;
  role: Role;
  hospital_id: number | null;
  donor_id: number | null;
};

const key = () => new TextEncoder().encode(env.authSecret);

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.user_id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return {
      user_id: Number(payload.user_id),
      email: String(payload.email),
      display_name: String(payload.display_name),
      role: payload.role as Role,
      hospital_id: payload.hospital_id === null ? null : Number(payload.hospital_id),
      donor_id: payload.donor_id === null ? null : Number(payload.donor_id),
    };
  } catch {
    return null; // expired, tampered with, or signed with another secret
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1",
  path: "/",
  maxAge: SESSION_HOURS * 60 * 60,
};

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

/** Throws 401 when not signed in, 403 when the role is not allowed. */
export async function requireUser(request: NextRequest, ...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  if (roles.length > 0 && !roles.includes(user.role)) throw forbidden();
  return user;
}

/** Staff may only change records that belong to their own hospital. */
export function assertOwnHospital(user: SessionUser, hospitalId: number): void {
  if (user.role !== "STAFF" || user.hospital_id !== hospitalId) {
    throw forbidden("You can only manage records for your own hospital.");
  }
}
