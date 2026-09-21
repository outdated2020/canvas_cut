import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12" />
      <path d="M8 6.5 12 3l4 3.5" />
      <path d="M5 13v7h14v-7" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 13 4 8.5 8.5 4" />
      <path d="M4 8.5h9a6 6 0 0 1 0 12H10" />
    </>
  ),
  redo: (
    <>
      <path d="M15.5 13 20 8.5 15.5 4" />
      <path d="M20 8.5h-9a6 6 0 0 0 0 12H14" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  sort: (
    <>
      <path d="M7 4v16" />
      <path d="M4.5 6.5 7 4l2.5 2.5" />
      <path d="M17 20V4" />
      <path d="M14.5 17.5 17 20l2.5-2.5" />
    </>
  ),
  filter: <path d="M4 5h16l-6.5 8v6l-3-2v-4z" />,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  folderOpen: (
    <>
      <path d="M3.5 17.5V7a2 2 0 0 1 2-2h4l2 2.5h5" />
      <path d="M6.5 17.5 8 11h13l-2 6.5z" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </>
  ),
  cloud: (
    <>
      <path d="M6.8 18.5a4.3 4.3 0 0 1-.3-8.6 5.8 5.8 0 0 1 11.3 1.6 3.6 3.6 0 0 1-.6 7z" />
      <path d="M12 16v-5" />
      <path d="M9.8 12.8 12 10.5l2.2 2.3" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 3v9a6 6 0 0 0 12 0V3" />
      <path d="M6 3h4v4H6zM14 3h4v4h-4z" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.6 8.1 20 19M8.6 15.9 20 5" />
    </>
  ),
  unlink: (
    <>
      <path d="M9 15l6-6" />
      <path d="M11.5 5.5 14 3a4.2 4.2 0 0 1 6 6l-2.5 2.5" />
      <path d="M12.5 18.5 10 21a4.2 4.2 0 0 1-6-6l2.5-2.5" />
    </>
  ),
  marker: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h13l-3.5 4.5L18 13H5" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5v14M16 5v14" />,
  skipBack: (
    <>
      <path d="M6 5v14" />
      <path d="M18 5.5v13L9 12z" fill="currentColor" stroke="none" />
    </>
  ),
  stepBack: (
    <>
      <path d="M6 5v14" />
      <path d="M12 5v14" />
      <path d="M18 5.5v13L9 12z" fill="currentColor" stroke="none" />
    </>
  ),
  stepFwd: (
    <>
      <path d="M6 5.5v13L15 12z" fill="currentColor" stroke="none" />
      <path d="M12 5v14" />
      <path d="M18 5v14" />
    </>
  ),
  loop: (
    <>
      <path d="M17 4v4h-4" />
      <path d="M7 20v-4h4" />
      <path d="M7.5 7.5A6.5 6.5 0 0 1 18 9" />
      <path d="M16.5 16.5A6.5 6.5 0 0 1 6 15" />
    </>
  ),
  audio: (
    <>
      <path d="M12 3v13" />
      <path d="M8 8v3M16 8v3" />
      <path d="M4 12v1a8 8 0 0 0 16 0v-1" />
    </>
  ),
  skipFwd: (
    <>
      <path d="M18 5v14" />
      <path d="M6 5.5v13L15 12z" fill="currentColor" stroke="none" />
    </>
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  send: (
    <>
      <path d="M4 11.5 20 4l-4.5 16-4-6.5z" />
      <path d="M20 4 11.5 13.5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </>
  ),
  attach: <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7-7" />,
  history: (
    <>
      <path d="M12 7v5l3.5 2" />
      <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
      <path d="M3.5 12V7.5M3.5 12H8" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  spark: <path d="M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z" />,
  film: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  clapper: (
    <>
      <rect x="3.5" y="9" width="17" height="11" rx="1.5" />
      <path d="M3.5 9 6 4h15l-2.5 5" />
      <path d="M9 4l-2.5 5M14.5 4 12 9" />
    </>
  ),
  playCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5z" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4.5 17.5 10 12l4 4 2.5-2.5 3 3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10.5 21 8v8l-5-2.5" />
    </>
  )
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
