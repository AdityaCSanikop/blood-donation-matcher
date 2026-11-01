import { AppShell } from "@/components/AppShell";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allow={["STAFF"]}>{children}</AppShell>;
}
