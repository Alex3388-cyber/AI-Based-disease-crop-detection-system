export type IconName =
  | 'arrow'
  | 'camera'
  | 'check'
  | 'close'
  | 'download'
  | 'home'
  | 'info'
  | 'leaf'
  | 'microscope'
  | 'refresh'
  | 'shield'
  | 'spark'
  | 'upload'
  | 'warning'
  | 'wifi'
  | 'wifi-off';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const paths: Record<IconName, ReactNode> = {
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  camera: (
    <>
      <path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8v.01" />
    </>
  ),
  leaf: <path d="M4 18C4 9 10 4 20 4c0 10-5 16-14 16m0 0c3-5 7-8 12-11" />,
  microscope: (
    <>
      <path d="m8 3 5 5-3 3-5-5 3-3Zm3 7 3 3" />
      <path d="M6 21h12M12 18a6 6 0 0 0 6-6h-3a3 3 0 0 1-6 0" />
    </>
  ),
  refresh: <path d="M20 7v5h-5M4 17v-5h5m10.5-2a8 8 0 0 0-13-3L4 12m16 0-2.5 5a8 8 0 0 1-13-3" />,
  shield: <path d="M12 3 4.5 6v5c0 4.8 3 8.2 7.5 10 4.5-1.8 7.5-5.2 7.5-10V6L12 3Zm-3 9 2 2 4-5" />,
  spark: <path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />,
  warning: (
    <>
      <path d="M10.3 4.1 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.1a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4m0 4v.01" />
    </>
  ),
  wifi: <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0" />,
  'wifi-off': <path d="m3 3 18 18M8.5 16a5 5 0 0 1 4.5-1.3M5 12.5a10 10 0 0 1 3-2M2 9a15 15 0 0 1 3-1.7m5-2.1A15 15 0 0 1 22 9M12 20h.01" />,
};

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
import type { ReactNode } from 'react';
