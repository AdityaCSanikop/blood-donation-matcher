import Link from "next/link";
import { BrandMark } from "@/components/icons";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <nav aria-label="Public" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/login" className="flex items-center gap-2 font-semibold">
            <BrandMark /> <span className="hidden sm:inline">Blood Donation Matcher</span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link href="/login#how-it-works" className="rounded-md px-3 py-1.5 text-ink-soft hover:text-ink">How it works</Link>
            <Link href="/login#compatibility" className="hidden rounded-md px-3 py-1.5 text-ink-soft hover:text-ink sm:block">Compatibility</Link>
            <Link href="/register" className="rounded-md border border-line bg-elevated px-3 py-1.5 font-medium transition-colors duration-150 hover:border-ink-soft">Become a donor</Link>
          </div>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
