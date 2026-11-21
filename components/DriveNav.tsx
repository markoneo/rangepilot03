import type { ReactNode } from 'react';

/** Turn-by-turn navigation inside the app exists on iOS only (DriveNav.ios.tsx). */
export const navAvailable = false;

export type DriveNavProps = {
  origin: { lat: number; lon: number };
  dest: { lat: number; lon: number; name: string };
  chargers: { lat: number; lon: number; label: string }[];
  onClose: () => void;
  onError: (message: string) => void;
  children?: ReactNode;
};

export function DriveNav(_props: DriveNavProps) {
  return null;
}
