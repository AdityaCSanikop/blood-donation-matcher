"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { Role } from "@/lib/constants";
import { BrandMark, BuildingIcon, DropIcon, GridIcon, HeartIcon, LogoutIcon, MenuIcon, PulseIcon, UserIcon, UsersIcon } from "./icons";
import { Loading, cx } from "./ui";

export type Me = {
  user_id: number;
  email: string;
  display_name: string;
  role: Role;
  hospital_id: number | null;
  donor_id: number | null;
  hospital_name: string | null;
  hospital_city: string | null;
};

const SessionContext = createContext<Me | null>(null);
/** The signed-in user. Only call inside <AppShell>. */
export const useMe = () => useContext(SessionContext)!;

const STAFF_NAV = [
  { href: "/", label: "Dashboard", icon: <GridIcon /> },
  { href: "/requests", label: "Blood requests", icon: <DropIcon /> },
  { href: "/donors", label: "Donors", icon: <UsersIcon /> },
  { href: "/recipients", label: "Recipients", icon: <UserIcon /> },
  { href: "/donations", label: "Donations", icon: <HeartIcon /> },
  { href: "/hospitals", label: "Hospitals", icon: <BuildingIcon /> },
  { href: "/activity", label: "Activity log", icon: <PulseIcon /> },
];
const DONOR_NAV = [{ href: "/me", label: "My donor profile", icon: <UserIcon /> }];

export function AppShell({ children, allow }: { children: ReactNode; allow: Role[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/auth/me")
      .then(({ data }) => {
        if (cancelled) return;
        if (!allow.includes(data.role)) {
          router.replace(data.role === "DONOR" ? "/me" : "/");
          return;
        }
        setMe(data);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-5xl px-4">
        <Loading what="Checking your sign-in" />
      </main>
    );
  }

  const nav = me.role === "STAFF" ? STAFF_NAV : DONOR_NAV;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const home = me.role === "STAFF" ? "/" : "/me";

  return (
    <SessionContext.Provider value={me}>
      <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* Phone: a top bar that opens the sidebar as a drawer. */}
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper px-4 py-3 lg:hidden">
          <Link href={home} className="flex items-center gap-2 font-semibold">
            <BrandMark /> Blood Donation Matcher
          </Link>
          <button type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="rounded-md p-1.5 text-ink-soft hover:bg-elevated hover:text-ink">
            <MenuIcon />
          </button>
        </div>
        {menuOpen && <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

        <aside
          className={cx(
            "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0",
            menuOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible",
          )}
        >
          <Link href={home} className="flex items-center gap-2 px-4 py-4 text-sm font-semibold whitespace-nowrap">
            <BrandMark /> Blood Donation Matcher
          </Link>
          <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                  isActive(item.href) ? "bg-elevated font-medium text-ink" : "text-ink-soft hover:bg-elevated/60 hover:text-ink",
                )}
              >
                <span className={isActive(item.href) ? "text-venous" : undefined}>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line-soft p-2">
            <p className="truncate px-3 pt-1 text-sm font-medium">{me.display_name}</p>
            <p className="truncate px-3 pb-2 text-[13px] text-ink-soft">{me.role === "STAFF" ? (me.hospital_name ?? "Hospital staff") : "Donor"}</p>
            <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-soft transition-colors duration-150 hover:bg-elevated/60 hover:text-ink">
              <LogoutIcon /> Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
