import type { JSX } from "@solidjs/web";

/** 24×24 line icons, drawn in the text colour. */
const Icon = (props: { children: JSX.Element }) => (
  <svg
    class="icon"
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
);

export const MapIcon = () => (
  <Icon>
    <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
);

export const CompareIcon = () => (
  <Icon>
    <path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9m11 0-3-3m3 3-3 3" />
  </Icon>
);

export const BoardIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M7 9h6M7 13h10M7 17h4" />
  </Icon>
);

export const PlacesIcon = () => (
  <Icon>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const AboutIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" />
  </Icon>
);

/** A trip's start: where you set off. */
export const StartIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
  </Icon>
);

/** A trip's end: where you're going. */
export const FinishIcon = () => (
  <Icon>
    <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
  </Icon>
);

/** A vehicle on the move: buses and trams on the map. */
export const VehicleIcon = () => (
  <Icon>
    <rect x="5" y="3" width="14" height="15" rx="3" />
    <path d="M5 11h14M8 21l1.5-3M16 21l-1.5-3" />
    <path d="M9 14.5h.01M15 14.5h.01" stroke-width="2.6" />
  </Icon>
);
