import { InjectionToken } from '@angular/core';

/** Inline SVG icons (24×24 viewBox, `currentColor`). Provide your own set to restyle. */
export interface WeReportIcons {
  zoomIn: string;
  zoomOut: string;
  print: string;
  download: string;
  undo: string;
  redo: string;
  trash: string;
  text: string;
  field: string;
  line: string;
  rectangle: string;
  ellipse: string;
  image: string;
  barcode: string;
  qrcode: string;
  pageInfo: string;
  checkbox: string;
  preview: string;
  design: string;
  database: string;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const WE_REPORT_DEFAULT_ICONS: WeReportIcons = {
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  field: svg('<path d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h2M16 4h2a2 2 0 012 2v12a2 2 0 01-2 2h-2M9 12h6"/>'),
  line: svg('<path d="M4 20L20 4"/>'),
  rectangle: svg('<rect x="3" y="5" width="18" height="14" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  barcode: svg('<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>'),
  qrcode: svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>'),
  pageInfo: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 16h6"/>'),
  checkbox: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>'),
  preview: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  design: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  database: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
};

export const WE_REPORT_ICONS = new InjectionToken<WeReportIcons>('WE_REPORT_ICONS', {
  providedIn: 'root',
  factory: () => WE_REPORT_DEFAULT_ICONS,
});
