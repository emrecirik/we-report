/**
 * Output of the layout engine: pages of absolutely positioned primitives. Every renderer (HTML,
 * PDF, image) draws only this — none of them re-runs layout. Lengths are millimetres from the
 * page's top-left corner; font sizes are points.
 */
export interface LayoutDocument {
  pages: LayoutPage[];
  problems: LayoutProblem[];
  /**
   * Picture addresses (http/https) the report showed but `LayoutOptions.images` did not hold:
   * fetch them, pass them in `images` and lay out again. Absent when there are none.
   */
  imageUrls?: string[];
  /** The document map: one entry per printed section with a `bookmark`, in print order. */
  bookmarks?: LayoutBookmark[];
}

export interface LayoutBookmark {
  title: string;
  /** 0-based page and the top of the section on it (mm). */
  pageIndex: number;
  y: number;
  /** 0 for the outermost group; entries of deeper groups and of detail rows nest under it. */
  level: number;
}

export interface LayoutPage {
  width: number;
  height: number;
  items: LayoutItem[];
}

export interface LayoutProblem {
  code: 'expression' | 'barcode' | 'image' | 'overflow' | 'data';
  controlId?: string;
  message: string;
}

export interface TextLine {
  text: string;
  /** Left edge of the line. */
  x: number;
  baseline: number;
  width: number;
}

export interface TextItem {
  kind: 'text';
  /** Box the text is clipped to. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: TextLine[];
  /** `FontRegistry` face key (`family|variant`). */
  fontKey: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  size: number;
  color: string;
  underline: boolean;
}

export interface RectItem {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface EllipseItem {
  kind: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface LineItem {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface ImageItem {
  kind: 'image';
  /** Where the image is drawn (may exceed the clip box for `cover`). */
  x: number;
  y: number;
  width: number;
  height: number;
  clip: { x: number; y: number; width: number; height: number };
  /** `data:` URI of a PNG or JPEG. */
  src: string;
}

export interface PathItem {
  kind: 'path';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Coordinate system of `paths`; scaled to the item box. */
  viewBox: { width: number; height: number };
  paths: { d: string; fill?: string; stroke?: string; strokeWidth?: number }[];
}

export type LayoutItem = TextItem | RectItem | EllipseItem | LineItem | ImageItem | PathItem;
