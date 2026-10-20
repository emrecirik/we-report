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
  chart: string;
  table: string;
  textLeft: string;
  textCenter: string;
  textRight: string;
  textJustify: string;
  borderAll: string;
  borderNone: string;
  brush: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  chevronUp: string;
  chevronDown: string;
  thumbnails: string;
  keyboard: string;
  edit: string;
  fitHeight: string;
  noColor: string;
  wand: string;
  sum: string;
  arrangeLeft: string;
  arrangeCenter: string;
  arrangeRight: string;
  arrangeTop: string;
  arrangeMiddle: string;
  arrangeBottom: string;
  distributeH: string;
  distributeV: string;
  sameWidth: string;
  sameHeight: string;
  bringToFront: string;
  sendToBack: string;
  cut: string;
  copy: string;
  paste: string;
  outline: string;
  fitWidth: string;
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
  textLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  textCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  textRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  textJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
  borderAll: svg('<rect x="4" y="4" width="16" height="16" rx="1"/>'),
  borderNone: svg('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2 3"/>'),
  brush: svg('<rect x="4" y="3" width="14" height="6" rx="1.5"/><path d="M18 6h2v5h-8v3"/><rect x="10.5" y="14" width="3" height="7" rx="1"/>'),
  firstPage: svg('<path d="M6 5v14M18 6l-7 6 7 6"/>'),
  previousPage: svg('<path d="M15 6l-6 6 6 6"/>'),
  nextPage: svg('<path d="M9 6l6 6-6 6"/>'),
  lastPage: svg('<path d="M18 5v14M6 6l7 6-7 6"/>'),
  chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  thumbnails: svg('<rect x="3" y="3" width="7" height="8" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 5h7M14 9h5M14 16h7M14 20h5"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  fitHeight: svg('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
  noColor: svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
  wand: svg('<path d="M4 20L15 9"/><path d="M14 4v3M18 6l-2 2M20 10h-3M17 14l-2-2"/>'),
  sum: svg('<path d="M17 5H7l5 7-5 7h10"/>'),
  table: svg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M3 14.5h18M9 5v14M15 5v14"/>'),
  chart: svg('<path d="M4 20h16"/><rect x="5" y="11" width="3" height="9" rx="0.5"/><rect x="10.5" y="6" width="3" height="14" rx="0.5"/><rect x="16" y="13" width="3" height="7" rx="0.5"/>'),
  database: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  arrangeLeft: svg('<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'),
  arrangeCenter: svg('<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>'),
  arrangeRight: svg('<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>'),
  arrangeTop: svg('<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>'),
  arrangeMiddle: svg('<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>'),
  arrangeBottom: svg('<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>'),
  distributeH: svg('<path d="M3 4v16M21 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>'),
  distributeV: svg('<path d="M4 3h16M4 21h16"/><rect x="7" y="9" width="10" height="6" rx="1"/>'),
  sameWidth: svg('<path d="M4 8h16M4 5v6M20 5v6"/><rect x="4" y="14" width="16" height="5" rx="1"/>'),
  sameHeight: svg('<path d="M8 4v16M5 4h6M5 20h6"/><rect x="14" y="4" width="5" height="16" rx="1"/>'),
  bringToFront: svg('<rect x="3" y="3" width="11" height="11" rx="1" stroke-dasharray="2 2"/><rect x="10" y="10" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".25"/>'),
  sendToBack: svg('<rect x="3" y="3" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".25"/><rect x="10" y="10" width="11" height="11" rx="1" stroke-dasharray="2 2"/>'),
  cut: svg('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16L19 4M16 16L5 4"/>'),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),
  paste: svg('<path d="M9 4h6v3H9z"/><path d="M15 5h2a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h2"/>'),
  outline: svg('<path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"/>'),
  fitWidth: svg('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4M3 4v16M21 4v16"/>'),
};

export const WE_REPORT_ICONS = new InjectionToken<WeReportIcons>('WE_REPORT_ICONS', {
  providedIn: 'root',
  factory: () => WE_REPORT_DEFAULT_ICONS,
});
