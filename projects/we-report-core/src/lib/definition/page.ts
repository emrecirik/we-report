import { findPaperSize } from '../paper-sizes';
import { PageSettings } from './report-definition';

export interface PageGeometry {
  /** Physical page size after orientation; `height: null` for continuous media. */
  width: number;
  height: number | null;
  /** Printable area inside the margins. */
  contentWidth: number;
  contentHeight: number | null;
}

export function resolvePageGeometry(page: PageSettings): PageGeometry {
  let width: number;
  let height: number | null;
  if (page.paper === 'custom') {
    if (!page.width || page.width <= 0) {
      throw new Error('Custom paper needs a positive width.');
    }
    width = page.width;
    height = page.height ?? null;
  } else {
    const paper = findPaperSize(page.paper);
    if (!paper) {
      throw new Error(`Unknown paper size "${page.paper}".`);
    }
    width = paper.width;
    height = paper.height;
  }
  // Continuous media has no meaningful landscape orientation.
  if (page.orientation === 'landscape' && height !== null) {
    [width, height] = [height, width];
  }
  const { top, right, bottom, left } = page.margins;
  const contentWidth = width - left - right;
  const contentHeight = height === null ? null : height - top - bottom;
  if (contentWidth <= 0 || (contentHeight !== null && contentHeight <= 0)) {
    throw new Error('Margins leave no printable area.');
  }
  return { width, height, contentWidth, contentHeight };
}
