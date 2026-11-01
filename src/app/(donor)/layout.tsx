import { AppShell } from "@/components/AppShell";

export default function DonorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell allow={["DONOR"]}>{children}</AppShell>;
}
