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
