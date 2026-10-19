import { CURRENT_DEFINITION_VERSION, ReportDefinition, ReportStyle } from './report-definition';

/** The style every control falls back to. The only place output colours/fonts have defaults. */
export const DEFAULT_STYLE: Required<Omit<ReportStyle, 'border' | 'backgroundColor'>> = {
  fontFamily: 'Noto Sans',
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  color: '#1f2328',
  textAlign: 'left',
  verticalAlign: 'top',
  padding: 0.5,
};

/** Default chart series colours and grid colour; a chart's `colors` overrides the palette. */
export const DEFAULT_CHART_PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];
export const DEFAULT_CHART_GRID_COLOR = '#d0d7de';
export const DEFAULT_WATERMARK_COLOR = '#e3e6ea';
export const DEFAULT_TABLE_BORDER_COLOR = '#c8ced6';

export function createBlankReport(name = 'Report'): ReportDefinition {
  return {
    version: CURRENT_DEFINITION_VERSION,
    name,
    page: {
      paper: 'A4',
      orientation: 'portrait',
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      displayUnit: 'mm',
    },
    styles: { default: { ...DEFAULT_STYLE } },
    dataSources: [],
    bands: [
      { id: 'pageHeader', kind: 'pageHeader', height: 15, controls: [] },
      { id: 'detail', kind: 'detail', height: 8, controls: [] },
      { id: 'pageFooter', kind: 'pageFooter', height: 10, controls: [] },
    ],
  };
}
