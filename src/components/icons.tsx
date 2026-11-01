import type { ReactNode } from "react";

/** Small outline icons, drawn inline so the project needs no icon package. */
function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

const DROP = "M12 3s6.5 6.6 6.5 11.2A6.5 6.5 0 0 1 12 21a6.5 6.5 0 0 1-6.5-6.8C5.5 9.6 12 3 12 3z";

export const DropIcon = ({ size }: { size?: number }) => <Svg size={size}><path d={DROP} /></Svg>;
export const GridIcon = () => <Svg><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Svg>;
export const UsersIcon = () => <Svg><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c1.8.8 3 2.8 3 5.6" /></Svg>;
export const UserIcon = () => <Svg><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c.8-3.7 3.8-6 7.5-6s6.700 2.300 7.500 6" /></Svg>;
export const HeartIcon = () => <Svg><path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7a4.300 4.300 0 0 1 7.500 2.800C19.500 15.400 12 20 12 20z" /></Svg>;
export const BuildingIcon = () => <Svg><path d="M5 21V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16M3 21h18M12 8v5M9.500 10.500h5M10 21v-4h4v4" /></Svg>;
export const PulseIcon = () => <Svg><path d="M3 12h4l2.500-6 4 12 2.500-6h5" /></Svg>;
export const MenuIcon = () => <Svg size={20}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const LogoutIcon = () => <Svg><path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9" /></Svg>;
export const ArrowIcon = () => <Svg size={16}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const RefreshIcon = () => <Svg size={16}><path d="M20 11a8 8 0 0 0-14.500-3.500L4 9M4 4v5h5M4 13a8 8 0 0 0 14.500 3.500L20 15M20 20v-5h-5" /></Svg>;

/** The brand mark: a filled drop, used in the navbar and the sidebar. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d={DROP} fill="var(--color-venous)" />
      <path d="M8.500 14.500h2l1-2.500 1.500 4 1-1.500h1.500" fill="none" stroke="#fff" strokeWidth="1.300" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
