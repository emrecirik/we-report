import { InjectionToken } from '@angular/core';
import { BandKind, ReportControlType } from 'we-report-core';

/** Every user-facing string of the designer and viewer. Add new keys to both locales below. */
export interface WeReportLocale {
  designerLabel: string;
  bandNames: Record<BandKind, string>;
  controlNames: Record<ReportControlType, string>;

  // Viewer
  zoomIn: string;
  zoomOut: string;
  print: string;
  downloadPdf: string;
  downloadExcel: string;
  documentMap: string;
  downloadPng: string;
  pngAllPages: string;
  printerOutput: string;
  printerOutputHint: string;
  printerZpl: string;
  printerEscPos: string;
  /** `{0}` = number of pages. */
  pageCount: string;
  problems: string;
  loading: string;
  layoutError: string;
  runReport: string;
  dataLoadError: string;

  // Designer shell
  design: string;
  preview: string;
  undo: string;
  redo: string;
  delete: string;
  duplicate: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  arrange: string;
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
  arrangeHint: string;
  explorer: string;
  /** `{0}` = number of selected items. */
  itemsSelected: string;
  explorerHint: string;
  emptyBand: string;
  add: string;
  data: string;
  fitWidth: string;
  basicMode: string;
  advancedMode: string;
  toolbox: string;
  toolboxHint: string;
  fields: string;
  fieldsHint: string;
  parentFields: string;
  noFields: string;
  properties: string;
  addBand: string;
  removeBand: string;
  groupBy: string;
  newText: string;
  showData: string;

  // Property groups
  groupLayout: string;
  groupContent: string;
  groupAppearance: string;
  groupBehaviour: string;
  groupPage: string;
  groupData: string;

  // Properties
  reportName: string;
  paper: string;
  orientation: string;
  portrait: string;
  landscape: string;
  customSize: string;
  width: string;
  height: string;
  margins: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  pageColor: string;
  mirrorMargins: string;
  mirrorMarginsHint: string;
  left: string;
  top: string;
  content: string;
  staticText: string;
  fromData: string;
  expression: string;
  expressionHint: string;
  format: string;
  formatNone: string;
  formatNumber0: string;
  formatNumber2: string;
  formatCurrency: string;
  formatPercent: string;
  formatDate: string;
  formatDateTime: string;
  formatLongDate: string;
  formatDayDate: string;
  font: string;
  fontSize: string;
  bold: string;
  italic: string;
  underline: string;
  alignment: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  verticalAlignment: string;
  alignTop: string;
  alignMiddle: string;
  alignBottom: string;
  textColor: string;
  backgroundColor: string;
  noColor: string;
  border: string;
  borderWidth: string;
  borderColor: string;
  padding: string;
  canGrow: string;
  canGrowHint: string;
  richText: string;
  richTextHint: string;
  visibleWhen: string;
  visibleWhenHint: string;
  symbology: string;
  barcodeValue: string;
  showText: string;
  imageSource: string;
  chooseImage: string;
  fit: string;
  fitContain: string;
  fitCover: string;
  fitStretch: string;
  fitNone: string;
  lineDirection: string;
  horizontal: string;
  vertical: string;
  diagonalDown: string;
  diagonalUp: string;
  lineWidth: string;
  color: string;
  shape: string;
  rectangle: string;
  roundedRectangle: string;
  ellipse: string;
  cornerRadius: string;
  pageInfo: string;
  pageNumber: string;
  pageTotal: string;
  pageNofM: string;
  printDate: string;
  checked: string;
  bandHeight: string;
  sortGroups: string;
  sortAsc: string;
  sortDesc: string;
  sortNone: string;
  keepTogether: string;
  keepTogetherHint: string;
  groupTop: string;
  groupOrderBy: string;
  groupOrderByHint: string;
  largestFirst: string;
  keepWithFirstRow: string;
  bookmark: string;
  bookmarkHint: string;
  alternateBackground: string;
  bandVisible: string;
  bandVisibleHint: string;
  resetPageNumber: string;
  resetPageNumberHint: string;
  repeatOnEveryPage: string;
  pageBreakBefore: string;
  pageBreakAfter: string;
  dataRows: string;
  dataRowsHint: string;
  dataSources: string;
  close: string;
  rowsSource: string;
  noSources: string;
  webService: string;
  parameters: string;
  parametersHint: string;
  parameterName: string;
  parameterType: string;
  parameterLabel: string;
  defaultValue: string;
  calculatedFields: string;
  calculatedFieldsHint: string;
  calculatedFieldName: string;
  addCalculatedField: string;
  parameterChoices: string;
  parameterChoicesFrom: string;
  parameterNoList: string;
  addParameter: string;
  sourceName: string;
  wholeData: string;
  rowCount: string;
  useForRows: string;
  jsonData: string;
  invalidJson: string;
  csvData: string;
  method: string;
  url: string;
  test: string;
  testing: string;
  testOk: string;
  headers: string;
  headerName: string;
  headerValue: string;
  addHeader: string;
  requestBody: string;
  secretWarning: string;
  removeSource: string;
  typeText: string;
  typeNumber: string;
  typeDate: string;
  typeYesNo: string;
  database: string;
  backendAddress: string;
  connect: string;
  connected: string;
  connection: string;
  writeSql: string;
  sqlHint: string;
  table: string;
  columns: string;
  filters: string;
  fixedValue: string;
  addFilter: string;
  sortBy: string;
  maxRows: string;
  opLike: string;
  opIsEmpty: string;
  opIsNotEmpty: string;
  rowLimitReached: string;
  viaBackend: string;
  viaBackendHint: string;
  paging: string;
  pagingHint: string;
  pageSize: string;
  autoDesign: string;
  autoDesignHint: string;
  newReportTitle: string;
  totalLabel: string;
  pageOfFormat: string;
  issueOutsidePage: string;
  issueFormulaError: string;
  issueUnknownField: string;
  issueEmptyFormula: string;
  issueOverlap: string;
  issueOutsideColumn: string;
  issueCheckDigit: string;
  fixIt: string;
  noProblems: string;
  chartType: string;
  chartColumn: string;
  chartBar: string;
  chartLine: string;
  chartPie: string;
  chartDoughnut: string;
  chartMax: string;
  chartDataBar: string;
  chartSparkline: string;
  chartRows: string;
  chartRowsHint: string;
  chartCategory: string;
  chartValue: string;
  chartAggregate: string;
  aggSum: string;
  aggCount: string;
  aggAvg: string;
  aggMin: string;
  aggMax: string;
  chartTitle: string;
  showValues: string;
  showLegend: string;
  chartHint: string;
  crosstabHint: string;
  crosstabRows: string;
  crosstabColumns: string;
  crosstabValue: string;
  crosstabTotals: string;
  crosstabTitle: string;
  subreportHint: string;
  subreportEdit: string;
  subreportLoad: string;
  subreportLoadFailed: string;
  subreportRows: string;
  subreportRowsHint: string;
  subreportFilter: string;
  subreportFilterHint: string;
  subreportParams: string;
  subreportTitle: string;
  subreportDone: string;
  subreportPageHint: string;
  conditionalFormatting: string;
  watermark: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  pageOf: string;
  search: string;
  matches: string;
  noMatches: string;
  fitPage: string;
  keyboardShortcuts: string;
  editText: string;
  editFormula: string;
  moveItem: string;
  moveFine: string;
  resizeItem: string;
  nextItem: string;
  rubberBand: string;
  noSnap: string;
  dragCopy: string;
  wizardTitle: string;
  wizardReportTitle: string;
  wizardColumns: string;
  noGrouping: string;
  wizardTotals: string;
  automatic: string;
  createReport: string;
  issueTextCut: string;
  stretch: string;
  stretchHint: string;
  fitToText: string;
  tidyUp: string;
  tidyUpHint: string;
  collapseBand: string;
  expandBand: string;
  groupByThis: string;
  addTotal: string;
  filterFields: string;
  previousMatch: string;
  nextMatch: string;
  zoomLevel: string;
  sortRows: string;
  dataOrder: string;
  addTextHere: string;
  fitBandToContent: string;
  thumbnails: string;
  snapGrid: string;
  gridOff: string;
  formatPainter: string;
  addByClick: string;
  resizePanel: string;
  alignJustify: string;
  noSelection: string;
  formatBar: string;
  allBorders: string;
  noBorder: string;
  innerList: string;
  innerListOf: string;
  innerListHint: string;
  innerFields: string;
  tableSection: string;
  addRow: string;
  addColumn: string;
  deleteRow: string;
  deleteColumn: string;
  mergeCells: string;
  splitCell: string;
  selectedCell: string;
  columnWidth: string;
  rowHeight: string;
  tableHint: string;
  columnN: string;
  labelSheet: string;
  labelSheetChoose: string;
  labelSheetHint: string;
  labelsCount: string;
  columnsCount: string;
  columnGap: string;
  columnsHint: string;
  repeatsAcross: string;
  reportLocale: string;
  reportLocaleRegion: string;
  reportCurrency: string;
  reportLocaleDefault: string;
  reportLocaleHint: string;
  formulaEditor: string;
  formulaEditorHint: string;
  formulaResult: string;
  formulaEmpty: string;
  apply: string;
  cancel: string;
  fnLogic: string;
  fnText: string;
  fnNumber: string;
  fnDate: string;
  fnAggregate: string;
  functions: string;
  openFormulaEditor: string;
  /** One sentence per function of `EXPRESSION_FUNCTIONS`, keyed by name. */
  functionHelp: Record<string, string>;
  watermarkHint: string;
  watermarkAngle: string;
  conditionalHint: string;
  addRule: string;
  ruleWhen: string;
  ruleThen: string;
  removeRule: string;
  opContains: string;
  ruleValue: string;
}

export const weReportLocaleEn: WeReportLocale = {
  designerLabel: 'Report design surface',
  bandNames: {
    reportHeader: 'Report header',
    pageHeader: 'Page header',
    groupHeader: 'Group header',
    detail: 'Detail (repeats for every row)',
    subHeader: 'Inner list header',
    subDetail: 'Inner list (repeats for every item)',
    subFooter: 'Inner list footer',
    groupFooter: 'Group footer',
    pageFooter: 'Page footer',
    reportFooter: 'Report footer',
  },
  controlNames: {
    text: 'Text',
    line: 'Line',
    shape: 'Shape',
    image: 'Image',
    barcode: 'Barcode',
    pageInfo: 'Page number / date',
    checkbox: 'Checkbox',
    chart: 'Chart',
    table: 'Table',
    crosstab: 'Cross table',
    subreport: 'Sub-report',
  },

  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  print: 'Print',
  downloadPdf: 'Download PDF',
  downloadExcel: 'Excel',
  documentMap: 'Document map',
  downloadPng: 'PNG',
  pngAllPages: 'PNG, every page (ZIP)',
  printerOutput: 'More formats',
  printerOutputHint: 'CSV for spreadsheets; files for label and receipt printers (the pages as an image the printer prints directly).',
  printerZpl: 'Label printer (ZPL, 203 dpi)',
  printerEscPos: 'Receipt printer (ESC/POS)',
  pageCount: '{0} page(s)',
  problems: 'Problems',
  loading: 'Preparing preview…',
  layoutError: 'The report could not be prepared',
  runReport: 'Run report',
  dataLoadError: 'Data could not be loaded',

  design: 'Design',
  preview: 'Preview',
  undo: 'Undo',
  redo: 'Redo',
  delete: 'Delete',
  duplicate: 'Duplicate',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  arrange: 'Arrange',
  arrangeLeft: 'Align left edges',
  arrangeCenter: 'Align centres',
  arrangeRight: 'Align right edges',
  arrangeTop: 'Align top edges',
  arrangeMiddle: 'Align middles',
  arrangeBottom: 'Align bottom edges',
  distributeH: 'Space evenly across',
  distributeV: 'Space evenly down',
  sameWidth: 'Same width',
  sameHeight: 'Same height',
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  arrangeHint: 'Select two or more items to align them; the first one you clicked stays put.',
  explorer: 'Outline',
  itemsSelected: '{0} items selected',
  explorerHint: 'Everything on the report, section by section. Click to select.',
  emptyBand: '(empty)',
  add: 'Add',
  data: 'Data',
  fitWidth: 'Fit to width',
  basicMode: 'Basic',
  advancedMode: 'Advanced',
  toolbox: 'Add to report',
  toolboxHint: 'Drag an item onto the page.',
  fields: 'Data fields',
  fieldsHint: 'Drag a field onto the page to show its value.',
  parentFields: 'Document fields',
  noFields: 'No data yet. Connect data to see its fields here.',
  properties: 'Properties',
  addBand: 'Add section',
  removeBand: 'Remove section',
  groupBy: 'Group by',
  newText: 'Text',
  showData: 'Show data',

  groupLayout: 'Position and size',
  groupContent: 'Content',
  groupAppearance: 'Appearance',
  groupBehaviour: 'Behaviour',
  groupPage: 'Page',
  groupData: 'Data',

  reportName: 'Report name',
  paper: 'Paper',
  orientation: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  customSize: 'Custom size',
  width: 'Width',
  height: 'Height',
  margins: 'Margins',
  marginTop: 'Top',
  marginRight: 'Right',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
  pageColor: 'Page colour',
  mirrorMargins: 'Mirror margins',
  mirrorMarginsHint: 'For booklets: on even pages the left and right margins swap.',
  left: 'From left',
  top: 'From top',
  content: 'Content',
  staticText: 'Fixed text',
  fromData: 'From data',
  expression: 'Formula',
  expressionHint: 'Fields in brackets, e.g. [Price] * [Quantity]',
  format: 'Show as',
  formatNone: 'As it is',
  formatNumber0: 'Number (1,235)',
  formatNumber2: 'Number (1,234.50)',
  formatCurrency: 'Money',
  formatPercent: 'Percent',
  formatDate: 'Date',
  formatDateTime: 'Date and time',
  formatLongDate: 'Long date (5 January 2026)',
  formatDayDate: 'With the day (Monday, 5 January 2026)',
  font: 'Font',
  fontSize: 'Size',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  alignment: 'Alignment',
  alignLeft: 'Left',
  alignCenter: 'Center',
  alignRight: 'Right',
  verticalAlignment: 'Vertical alignment',
  alignTop: 'Top',
  alignMiddle: 'Middle',
  alignBottom: 'Bottom',
  textColor: 'Text colour',
  backgroundColor: 'Background',
  noColor: 'None',
  border: 'Border',
  borderWidth: 'Border width',
  borderColor: 'Border colour',
  padding: 'Inner spacing',
  canGrow: 'Grow to fit text',
  canGrowHint: 'Long text makes the row taller instead of being cut off.',
  richText: 'Rich text',
  richTextHint: '**bold**, *italic*, __underline__ and data inside the text: Dear {[name]}',
  visibleWhen: 'Show only when',
  visibleWhenHint: 'A formula; the item is hidden when it is false, e.g. [Total] > 0',
  symbology: 'Barcode type',
  barcodeValue: 'Value',
  showText: 'Show digits under the code',
  imageSource: 'Picture',
  chooseImage: 'Choose picture…',
  fit: 'Fit',
  fitContain: 'Fit inside',
  fitCover: 'Fill (crop)',
  fitStretch: 'Stretch',
  fitNone: 'Original size',
  lineDirection: 'Direction',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  diagonalDown: 'Diagonal ↘',
  diagonalUp: 'Diagonal ↗',
  lineWidth: 'Thickness',
  color: 'Colour',
  shape: 'Shape',
  rectangle: 'Rectangle',
  roundedRectangle: 'Rounded rectangle',
  ellipse: 'Ellipse',
  cornerRadius: 'Corner roundness',
  pageInfo: 'Shows',
  pageNumber: 'Page number',
  pageTotal: 'Total pages',
  pageNofM: 'Page X of Y',
  printDate: 'Print date',
  checked: 'Ticked when',
  bandHeight: 'Section height',
  sortGroups: 'Order of groups',
  sortAsc: 'A → Z',
  sortDesc: 'Z → A',
  sortNone: 'As in data',
  keepTogether: 'Keep group on one page',
  keepTogetherHint: 'Moves the whole group to the next page instead of splitting it.',
  groupTop: 'Only the first … groups',
  groupOrderBy: 'Order groups by',
  groupOrderByHint: 'A formula over each group, e.g. Sum([amount]): the biggest customers first.',
  largestFirst: 'Largest first',
  keepWithFirstRow: 'Keep the header with the first row',
  bookmark: 'Bookmark',
  bookmarkHint: 'An entry in the PDF bookmarks and the preview’s document map, e.g. the customer’s name.',
  alternateBackground: 'Every second row',
  bandVisible: 'Print only when',
  bandVisibleHint: 'A formula, e.g. [Discount] > 0: otherwise the section is left out (its rows still count in totals).',
  resetPageNumber: 'New page and page numbers per group',
  resetPageNumberHint: 'Each group starts on a new page counted from 1 — e.g. one statement per customer, each “page 1 of 2”.',
  repeatOnEveryPage: 'Repeat on every page',
  pageBreakBefore: 'Start on a new page',
  pageBreakAfter: 'New page after',
  dataRows: 'Rows come from',
  dataRowsHint: 'Path to the list inside the data, e.g. lines',
  dataSources: 'Data sources',
  close: 'Close',
  rowsSource: 'rows',
  noSources: 'No data source yet. Add one on the left.',
  webService: 'Web service',
  parameters: 'Parameters',
  parametersHint: 'Asked before the report runs. Use [?name] in formulas and {{name}} in web service addresses.',
  parameterName: 'Parameter name',
  parameterType: 'Type',
  parameterLabel: 'Label shown to the user',
  defaultValue: 'Default value',
  calculatedFields: 'Calculated fields',
  calculatedFieldsHint: 'A formula worked out for every row and used like a data field, e.g. total = [qty] * [price], then [total] anywhere.',
  calculatedFieldName: 'Field name',
  addCalculatedField: 'Add calculated field',
  parameterChoices: 'Choices: A, B, C (optional)',
  parameterChoicesFrom: 'List from a data field',
  parameterNoList: 'Free entry',
  addParameter: 'Add parameter',
  sourceName: 'Name',
  wholeData: '(the whole data)',
  rowCount: '{0} row(s)',
  useForRows: 'Use this source for the report rows',
  jsonData: 'JSON data',
  invalidJson: 'This is not valid JSON',
  csvData: 'Paste a CSV or Excel table with its header row',
  method: 'Method',
  url: 'Address (URL)',
  test: 'Test',
  testing: 'Testing…',
  testOk: 'It works: {0} row(s) found. The response is saved for designing.',
  headers: 'Headers',
  headerName: 'Header name',
  headerValue: 'Header value',
  addHeader: 'Add header',
  requestBody: 'Request body',
  secretWarning: 'Anything written here is visible in the browser and saved in the report file. For secret keys, call the service through your backend.',
  removeSource: 'Remove this data source',
  typeText: 'Text',
  typeNumber: 'Number',
  typeDate: 'Date',
  typeYesNo: 'Yes / no',
  database: 'Database',
  backendAddress: 'Data backend address',
  connect: 'Connect',
  connected: 'Connected — {0} connection(s) available.',
  connection: 'Connection',
  writeSql: 'Write SQL myself',
  sqlHint: 'One SELECT statement. Use :name for report parameters.',
  table: 'Table',
  columns: 'Columns',
  filters: 'Only rows where',
  fixedValue: 'Value…',
  addFilter: 'Add condition',
  sortBy: 'Sort by',
  maxRows: 'Max rows',
  opLike: 'contains (like)',
  opIsEmpty: 'is empty',
  opIsNotEmpty: 'is not empty',
  rowLimitReached: '(row limit reached — more rows exist)',
  viaBackend: 'Call through the data backend',
  viaBackendHint: 'Use this when the service blocks browser calls (CORS) or needs a secret key the browser must not see.',
  paging: 'Paged API',
  pagingHint: 'Loads every page: write {{page}} (1, 2, 3 …) or {{offset}} and {{size}} in the address.',
  pageSize: 'Rows per page',
  autoDesign: 'Design from data',
  autoDesignHint: 'Builds a tidy list of your data with headers, totals and page numbers. Undo brings your design back.',
  newReportTitle: 'Report',
  totalLabel: 'Total',
  pageOfFormat: 'Page {0} of {1}',
  issueOutsidePage: 'goes past the edge of the paper',
  issueFormulaError: 'has a formula error: {0}',
  issueUnknownField: 'uses “{0}”, which is not in the data',
  issueEmptyFormula: 'has an empty formula',
  issueOverlap: 'overlaps {0}',
  issueOutsideColumn: 'goes past its column into the next label',
  issueCheckDigit: 'has a wrong check digit (the last digit should be {0}); it will not scan',
  fixIt: 'Fix',
  noProblems: 'No problems found.',
  chartType: 'Chart type',
  chartColumn: 'Columns',
  chartBar: 'Bars',
  chartLine: 'Line',
  chartPie: 'Pie',
  chartDoughnut: 'Doughnut',
  chartMax: 'Full bar at',
  chartDataBar: 'Data bar',
  chartSparkline: 'Sparkline',
  chartRows: 'Rows from a list in each row',
  chartRowsHint: 'E.g. [months]: a small chart in every detail row, from that row’s own list. Pick its fields as Group by / Value (or leave Group by empty for a sparkline).',
  chartCategory: 'Group by',
  chartValue: 'Value',
  chartAggregate: 'Calculation',
  aggSum: 'Total',
  aggCount: 'Count',
  aggAvg: 'Average',
  aggMin: 'Smallest',
  aggMax: 'Largest',
  chartTitle: 'Title',
  showValues: 'Show values',
  showLegend: 'Show legend',
  chartHint: 'A chart shows the rows of its section: every row in a report header or footer, the group’s rows in a group footer.',
  crosstabHint: 'A cross table sums the rows of its section: one row per value of one field, one column per value of another. In a report header or footer it shows every row, in a group footer the group’s rows.',
  crosstabRows: 'Rows',
  crosstabColumns: 'Columns',
  crosstabValue: 'Value',
  crosstabTotals: 'Totals row and column',
  crosstabTitle: 'Corner text',
  subreportHint: 'A separate report printed inside this box, e.g. the orders under each customer. The box grows to fit its rows.',
  subreportEdit: 'Edit sub-report…',
  subreportLoad: 'Use a saved report…',
  subreportLoadFailed: 'The file is not a we-report report (.wrpt.json).',
  subreportRows: 'Its rows come from',
  subreportRowsHint: 'Empty: the sub-report’s own data. For a list inside each row write e.g. [orders].',
  subreportFilter: 'Show only rows where',
  subreportFilterHint: 'E.g. [CustomerId] = [^.Id] — [^.field] reads the row around the box.',
  subreportParams: 'Parameter values',
  subreportTitle: 'Sub-report: {0}',
  subreportDone: 'Done',
  subreportPageHint: 'A sub-report is as wide as its box; paper and margins come from the report around it.',
  conditionalFormatting: 'Conditional formatting',
  watermark: 'Watermark',
  firstPage: 'First page',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  lastPage: 'Last page',
  pageOf: 'of {0}',
  search: 'Find in report',
  matches: '{0} of {1}',
  noMatches: 'No matches',
  fitPage: 'Whole page',
  keyboardShortcuts: 'Keyboard shortcuts',
  editText: 'Edit the text',
  editFormula: 'Edit the formula…',
  moveItem: 'Move',
  moveFine: 'Move by 0.1 mm',
  resizeItem: 'Make wider / narrower, taller / shorter',
  nextItem: 'Next / previous item',
  rubberBand: 'Select several: drag on an empty spot',
  noSnap: 'Hold while dragging: no snapping',
  dragCopy: 'Drag with Ctrl held to copy',
  wizardTitle: 'Report wizard',
  wizardReportTitle: 'Report title',
  wizardColumns: 'Columns to show',
  noGrouping: 'No grouping',
  wizardTotals: 'Totals of number columns',
  automatic: 'Automatic',
  createReport: 'Create report',
  issueTextCut: 'The text does not fit in its box and is cut off.',
  stretch: 'Extend to the bottom when the section grows',
  stretchHint: 'For cell borders and column lines next to a text that grows.',
  fitToText: 'Fit size to text',
  tidyUp: 'Tidy up',
  tidyUpHint: 'Puts the items on the grid and lines up those that are nearly in a row or a column.',
  collapseBand: 'Collapse section',
  expandBand: 'Expand section',
  groupByThis: 'Group rows by this value',
  addTotal: 'Add a total of this column',
  filterFields: 'Find a field',
  previousMatch: 'Previous match',
  nextMatch: 'Next match',
  zoomLevel: 'Zoom',
  sortRows: 'Sort rows by',
  dataOrder: 'Data order',
  addTextHere: 'Add text here',
  fitBandToContent: 'Fit section to its content',
  thumbnails: 'Page thumbnails',
  snapGrid: 'Snap to grid (hold Alt to move freely)',
  gridOff: 'No grid',
  formatPainter: 'Copy formatting: click it, then click another item (Esc cancels)',
  addByClick: 'Click an item (or double-click a field) to add it to the selected section.',
  resizePanel: 'Drag to resize, double-click to hide',
  alignJustify: 'Justify',
  noSelection: 'Nothing selected',
  formatBar: 'Format',
  allBorders: 'Border all round',
  noBorder: 'No border',
  innerList: 'Inner list',
  innerListOf: 'List inside each row',
  innerListHint: 'Repeats for every item of a list inside each row, e.g. a customer’s orders. [field] is the item, [^.field] the row around it.',
  innerFields: 'Inner list fields',
  tableSection: 'Table',
  addRow: 'Add row',
  addColumn: 'Add column',
  deleteRow: 'Delete row',
  deleteColumn: 'Delete column',
  mergeCells: 'Merge with next',
  splitCell: 'Split',
  selectedCell: 'Selected cell',
  columnWidth: 'Column width (mm)',
  rowHeight: 'Row height (mm)',
  tableHint: 'Click a cell to edit it. Drop a data field on a cell to show its value there.',
  columnN: 'Column {0}',
  labelSheet: 'Label sheet',
  labelSheetChoose: 'Choose a sheet…',
  labelSheetHint: 'Sets the paper, margins and label size. Page and report headers/footers are removed; undo brings them back.',
  labelsCount: '{0} labels',
  columnsCount: 'Side by side',
  columnGap: 'Gap between (mm)',
  columnsHint: 'Prints rows next to each other, e.g. labels or cards. Design one; the shaded area shows where the others go.',
  repeatsAcross: 'Repeats ×{0}',
  reportLocale: 'Language and region',
  reportLocaleRegion: 'Numbers and dates',
  reportCurrency: 'Currency',
  reportLocaleDefault: 'App default',
  reportLocaleHint: 'How this report writes numbers, dates, money and amounts in words, wherever it is printed.',
  formulaEditor: 'Formula editor',
  formulaEditorHint: 'Click a field or function to insert it at the cursor.',
  formulaResult: 'Result for the first row',
  formulaEmpty: '(empty)',
  apply: 'Apply',
  cancel: 'Cancel',
  fnLogic: 'Logic',
  fnText: 'Text',
  fnNumber: 'Number',
  fnDate: 'Date',
  fnAggregate: 'Totals',
  functions: 'Functions',
  openFormulaEditor: 'Open the formula editor',
  functionHelp: {
    Iif: 'Chooses between two values: the first when the condition is true, otherwise the second.',
    IsNull: 'The value, or the fallback when it is empty.',
    Switch: 'Picks the result for the first match, e.g. Switch([Status], 1, \'Open\', 2, \'Closed\', \'Other\').',
    In: 'True when the value is one of the others, e.g. In([City], \'Ankara\', \'İzmir\').',
    Concat: 'Joins texts together.',
    Len: 'Number of characters.',
    Upper: 'CAPITAL LETTERS (Turkish İ/ı handled).',
    Lower: 'small letters (Turkish İ/ı handled).',
    Trim: 'Removes spaces at both ends.',
    Substring: 'Part of a text, from a position (0 = first character).',
    Replace: 'Replaces every occurrence of a text.',
    Contains: 'True when the text contains the part.',
    StartsWith: 'True when the text starts with the part.',
    EndsWith: 'True when the text ends with the part.',
    ToString: 'The value as text.',
    Format: 'Shows a value with a pattern, e.g. \'n2\' or \'dd.MM.yyyy\'.',
    AmountInWords: 'An amount written in words with its currency, for invoices and cheques.',
    NumberToWords: 'A whole number written in words.',
    Round: 'Rounds to the given decimals (half away from zero).',
    Abs: 'The number without its sign.',
    Floor: 'Rounds down to a whole number.',
    Ceiling: 'Rounds up to a whole number.',
    ToNumber: 'Reads a number from text.',
    Today: 'The print date (no time).',
    Now: 'The print date and time.',
    Year: 'Year of a date.',
    Month: 'Month of a date (1–12).',
    Day: 'Day of the month.',
    AddDays: 'A date moved by a number of days, e.g. a due date.',
    AddMonths: 'A date moved by months; the 31st becomes the last day of a shorter month.',
    AddYears: 'A date moved by years.',
    DateDiff: 'Whole days, months or years between two dates, e.g. days overdue: DateDiff(\'day\', [due], Today()).',
    Left: 'The first characters of a text.',
    Right: 'The last characters of a text.',
    PadLeft: 'Fills a text from the left up to a length, e.g. PadLeft([no], 6, \'0\') → 000042.',
    Sum: 'Total over the rows in scope (group, page or report).',
    RowNumber: 'Position of the row: 1, 2, 3 … (restarts in every group).',
    RunningSum: 'Total so far: in a row, of the rows up to it (restarts in every group); in a page footer, of every row up to the end of the page (carried forward).',
    CarriedSum: 'Total of the rows on the pages before this one — “brought forward” in a page header.',
    Count: 'Number of rows in scope.',
    Avg: 'Average over the rows in scope.',
    Min: 'Smallest value over the rows in scope (or of two values).',
    Max: 'Largest value over the rows in scope (or of two values).',
  },
  watermarkHint: 'Large faint text behind every page, e.g. DRAFT or PAID. Can come from data.',
  watermarkAngle: 'Direction',
  conditionalHint: 'Change the look when a condition is true, e.g. negative amounts in red.',
  addRule: 'Add rule',
  ruleWhen: 'When',
  ruleThen: 'Then',
  removeRule: 'Remove rule',
  opContains: 'contains',
  ruleValue: 'Value',
};

export const weReportLocaleTr: WeReportLocale = {
  designerLabel: 'Rapor tasarım alanı',
  bandNames: {
    reportHeader: 'Rapor başlığı',
    pageHeader: 'Sayfa başlığı',
    groupHeader: 'Grup başlığı',
    detail: 'Detay (her satır için tekrarlanır)',
    subHeader: 'İç liste başlığı',
    subDetail: 'İç liste (her öğe için tekrarlanır)',
    subFooter: 'İç liste altlığı',
    groupFooter: 'Grup altlığı',
    pageFooter: 'Sayfa altlığı',
    reportFooter: 'Rapor altlığı',
  },
  controlNames: {
    text: 'Metin',
    line: 'Çizgi',
    shape: 'Şekil',
    image: 'Resim',
    barcode: 'Barkod',
    pageInfo: 'Sayfa no / tarih',
    checkbox: 'Onay kutusu',
    chart: 'Grafik',
    table: 'Tablo',
    crosstab: 'Çapraz tablo',
    subreport: 'Alt rapor',
  },

  zoomIn: 'Yakınlaştır',
  zoomOut: 'Uzaklaştır',
  print: 'Yazdır',
  downloadPdf: 'PDF indir',
  downloadExcel: 'Excel',
  documentMap: 'Belge haritası',
  downloadPng: 'PNG',
  pngAllPages: 'PNG, tüm sayfalar (ZIP)',
  printerOutput: 'Diğer biçimler',
  printerOutputHint: 'Tablolar için CSV; etiket ve fiş yazıcıları için dosyalar (sayfalar yazıcının doğrudan bastığı bir görüntü olarak).',
  printerZpl: 'Etiket yazıcısı (ZPL, 203 dpi)',
  printerEscPos: 'Fiş yazıcısı (ESC/POS)',
  pageCount: '{0} sayfa',
  problems: 'Sorunlar',
  loading: 'Önizleme hazırlanıyor…',
  layoutError: 'Rapor hazırlanamadı',
  runReport: 'Raporu oluştur',
  dataLoadError: 'Veri yüklenemedi',

  design: 'Tasarım',
  preview: 'Önizleme',
  undo: 'Geri al',
  redo: 'Yinele',
  delete: 'Sil',
  duplicate: 'Çoğalt',
  cut: 'Kes',
  copy: 'Kopyala',
  paste: 'Yapıştır',
  selectAll: 'Tümünü seç',
  arrange: 'Düzenle',
  arrangeLeft: 'Sol kenarları hizala',
  arrangeCenter: 'Ortaları hizala',
  arrangeRight: 'Sağ kenarları hizala',
  arrangeTop: 'Üst kenarları hizala',
  arrangeMiddle: 'Dikey ortaları hizala',
  arrangeBottom: 'Alt kenarları hizala',
  distributeH: 'Yatayda eşit aralıkla dağıt',
  distributeV: 'Dikeyde eşit aralıkla dağıt',
  sameWidth: 'Aynı genişlik',
  sameHeight: 'Aynı yükseklik',
  bringToFront: 'Öne getir',
  sendToBack: 'Arkaya gönder',
  arrangeHint: 'Hizalamak için iki veya daha fazla öğe seçin; ilk tıkladığınız yerinde kalır.',
  explorer: 'Gezgin',
  itemsSelected: '{0} öğe seçili',
  explorerHint: 'Rapordaki her şey, bölüm bölüm. Seçmek için tıklayın.',
  emptyBand: '(boş)',
  add: 'Ekle',
  data: 'Veri',
  fitWidth: 'Genişliğe sığdır',
  basicMode: 'Basit',
  advancedMode: 'Gelişmiş',
  toolbox: 'Rapora ekle',
  toolboxHint: 'Bir öğeyi sayfanın üzerine sürükleyin.',
  fields: 'Veri alanları',
  fieldsHint: 'Değerini göstermek için bir alanı sayfaya sürükleyin.',
  parentFields: 'Belge alanları',
  noFields: 'Henüz veri yok. Veri bağladığınızda alanlar burada görünür.',
  properties: 'Özellikler',
  addBand: 'Bölüm ekle',
  removeBand: 'Bölümü kaldır',
  groupBy: 'Grupla',
  newText: 'Metin',
  showData: 'Veriyi göster',

  groupLayout: 'Konum ve boyut',
  groupContent: 'İçerik',
  groupAppearance: 'Görünüm',
  groupBehaviour: 'Davranış',
  groupPage: 'Sayfa',
  groupData: 'Veri',

  reportName: 'Rapor adı',
  paper: 'Kağıt',
  orientation: 'Yön',
  portrait: 'Dikey',
  landscape: 'Yatay',
  customSize: 'Özel ölçü',
  width: 'Genişlik',
  height: 'Yükseklik',
  margins: 'Kenar boşlukları',
  marginTop: 'Üst',
  marginRight: 'Sağ',
  marginBottom: 'Alt',
  marginLeft: 'Sol',
  pageColor: 'Sayfa rengi',
  mirrorMargins: 'Ayna kenar boşlukları',
  mirrorMarginsHint: 'Kitapçık için: çift sayfalarda sol ve sağ boşluk yer değiştirir.',
  left: 'Soldan',
  top: 'Üstten',
  content: 'İçerik',
  staticText: 'Sabit metin',
  fromData: 'Veriden',
  expression: 'Formül',
  expressionHint: 'Alanlar köşeli parantezle yazılır, örn. [Fiyat] * [Miktar]',
  format: 'Gösterim',
  formatNone: 'Olduğu gibi',
  formatNumber0: 'Sayı (1.235)',
  formatNumber2: 'Sayı (1.234,50)',
  formatCurrency: 'Para',
  formatPercent: 'Yüzde',
  formatDate: 'Tarih',
  formatDateTime: 'Tarih ve saat',
  formatLongDate: 'Uzun tarih (5 Ocak 2026)',
  formatDayDate: 'Gün adıyla (Pazartesi, 5 Ocak 2026)',
  font: 'Yazı tipi',
  fontSize: 'Boyut',
  bold: 'Kalın',
  italic: 'İtalik',
  underline: 'Altı çizili',
  alignment: 'Hizalama',
  alignLeft: 'Sola',
  alignCenter: 'Ortaya',
  alignRight: 'Sağa',
  verticalAlignment: 'Dikey hizalama',
  alignTop: 'Üste',
  alignMiddle: 'Ortaya',
  alignBottom: 'Alta',
  textColor: 'Yazı rengi',
  backgroundColor: 'Arka plan',
  noColor: 'Yok',
  border: 'Kenarlık',
  borderWidth: 'Kenarlık kalınlığı',
  borderColor: 'Kenarlık rengi',
  padding: 'İç boşluk',
  canGrow: 'Metne göre uzasın',
  canGrowHint: 'Uzun metin kesilmek yerine satırı uzatır.',
  richText: 'Zengin metin',
  richTextHint: 'Metnin içinde **kalın**, *italik*, __altı çizili__ ve veri: Sayın {[ad]}',
  visibleWhen: 'Yalnızca şu durumda göster',
  visibleWhenHint: 'Bir formül; yanlışsa öğe gizlenir, örn. [Toplam] > 0',
  symbology: 'Barkod türü',
  barcodeValue: 'Değer',
  showText: 'Kodun altında rakamları göster',
  imageSource: 'Resim',
  chooseImage: 'Resim seç…',
  fit: 'Sığdırma',
  fitContain: 'İçine sığdır',
  fitCover: 'Doldur (kırp)',
  fitStretch: 'Uzat',
  fitNone: 'Orijinal boyut',
  lineDirection: 'Yön',
  horizontal: 'Yatay',
  vertical: 'Dikey',
  diagonalDown: 'Çapraz ↘',
  diagonalUp: 'Çapraz ↗',
  lineWidth: 'Kalınlık',
  color: 'Renk',
  shape: 'Şekil',
  rectangle: 'Dikdörtgen',
  roundedRectangle: 'Yuvarlak köşeli dikdörtgen',
  ellipse: 'Elips',
  cornerRadius: 'Köşe yuvarlaklığı',
  pageInfo: 'Gösterilen',
  pageNumber: 'Sayfa numarası',
  pageTotal: 'Toplam sayfa',
  pageNofM: 'Sayfa X / Y',
  printDate: 'Yazdırma tarihi',
  checked: 'İşaretli olsun',
  bandHeight: 'Bölüm yüksekliği',
  sortGroups: 'Grup sırası',
  sortAsc: 'A → Z',
  sortDesc: 'Z → A',
  sortNone: 'Verideki sırayla',
  keepTogether: 'Grubu tek sayfada tut',
  keepTogetherHint: 'Grup bölünecekse tamamını sonraki sayfaya taşır.',
  groupTop: 'Yalnızca ilk … grup',
  groupOrderBy: 'Grupları şuna göre sırala',
  groupOrderByHint: 'Her grubun üzerinde bir formül; örn. Sum([tutar]): en büyük müşteriler önce.',
  largestFirst: 'Büyükten küçüğe',
  keepWithFirstRow: 'Başlığı ilk satırla birlikte tut',
  bookmark: 'Yer imi',
  bookmarkHint: 'PDF yer imlerinde ve önizlemenin belge haritasında bir satır; örn. müşterinin adı.',
  alternateBackground: 'Her ikinci satır',
  bandVisible: 'Yalnızca şu durumda yazdır',
  bandVisibleHint: 'Bir formül, örn. [Indirim] > 0; değilse bölüm basılmaz (satırları toplamlarda yine sayılır).',
  resetPageNumber: 'Her grup yeni sayfada, kendi sayfa numarasıyla',
  resetPageNumberHint: 'Her grup yeni sayfada başlar ve 1’den numaralanır; örn. her müşteriye ayrı ekstre, her biri “sayfa 1 / 2”.',
  repeatOnEveryPage: 'Her sayfada tekrarla',
  pageBreakBefore: 'Yeni sayfada başlasın',
  pageBreakAfter: 'Sonrasında yeni sayfa',
  dataRows: 'Satırlar nereden gelsin',
  dataRowsHint: 'Veri içindeki listenin yolu, örn. lines',
  dataSources: 'Veri kaynakları',
  close: 'Kapat',
  rowsSource: 'satırlar',
  noSources: 'Henüz veri kaynağı yok. Soldan bir tane ekleyin.',
  webService: 'Web servisi',
  parameters: 'Parametreler',
  parametersHint: 'Rapor çalışmadan önce sorulur. Formülde [?ad], web servisi adresinde {{ad}} olarak kullanın.',
  parameterName: 'Parametre adı',
  parameterType: 'Tür',
  parameterLabel: 'Kullanıcıya görünen ad',
  defaultValue: 'Varsayılan değer',
  calculatedFields: 'Hesaplanan alanlar',
  calculatedFieldsHint: 'Her satır için hesaplanıp veri alanı gibi kullanılan formül; örn. toplam = [miktar] * [fiyat], sonra her yerde [toplam].',
  calculatedFieldName: 'Alan adı',
  addCalculatedField: 'Hesaplanan alan ekle',
  parameterChoices: 'Seçenekler: A, B, C (isteğe bağlı)',
  parameterChoicesFrom: 'Listeyi bir veri alanından al',
  parameterNoList: 'Serbest giriş',
  addParameter: 'Parametre ekle',
  sourceName: 'Ad',
  wholeData: '(verinin tamamı)',
  rowCount: '{0} satır',
  useForRows: 'Rapor satırları için bu kaynağı kullan',
  jsonData: 'JSON verisi',
  invalidJson: 'Bu geçerli bir JSON değil',
  csvData: 'Başlık satırıyla birlikte CSV ya da Excel tablosu yapıştırın',
  method: 'Yöntem',
  url: 'Adres (URL)',
  test: 'Test et',
  testing: 'Deneniyor…',
  testOk: 'Çalışıyor: {0} satır bulundu. Yanıt tasarım için kaydedildi.',
  headers: 'Başlıklar (header)',
  headerName: 'Başlık adı',
  headerValue: 'Başlık değeri',
  addHeader: 'Başlık ekle',
  requestBody: 'İstek gövdesi',
  secretWarning: 'Buraya yazılan her şey tarayıcıda görünür ve rapor dosyasına kaydedilir. Gizli anahtarlar için servisi backend’iniz üzerinden çağırın.',
  removeSource: 'Bu veri kaynağını kaldır',
  typeText: 'Metin',
  typeNumber: 'Sayı',
  typeDate: 'Tarih',
  typeYesNo: 'Evet / hayır',
  database: 'Veritabanı',
  backendAddress: 'Veri backend adresi',
  connect: 'Bağlan',
  connected: 'Bağlandı — {0} bağlantı var.',
  connection: 'Bağlantı',
  writeSql: 'SQL’i kendim yazayım',
  sqlHint: 'Tek bir SELECT sorgusu. Rapor parametreleri için :ad kullanın.',
  table: 'Tablo',
  columns: 'Sütunlar',
  filters: 'Yalnızca şu satırlar',
  fixedValue: 'Değer…',
  addFilter: 'Koşul ekle',
  sortBy: 'Sırala',
  maxRows: 'En fazla satır',
  opLike: 'içerir (like)',
  opIsEmpty: 'boş',
  opIsNotEmpty: 'boş değil',
  rowLimitReached: '(satır sınırına ulaşıldı — daha fazla satır var)',
  viaBackend: 'Veri backend’i üzerinden çağır',
  viaBackendHint: 'Servis tarayıcıdan çağrılmaya izin vermiyorsa (CORS) ya da tarayıcının görmemesi gereken gizli bir anahtar gerekiyorsa kullanın.',
  paging: 'Sayfalı API',
  pagingHint: 'Tüm sayfaları yükler: adrese {{page}} (1, 2, 3 …) ya da {{offset}} ve {{size}} yazın.',
  pageSize: 'Sayfa başına satır',
  autoDesign: 'Veriden otomatik tasarla',
  autoDesignHint: 'Verinizden başlıklı, toplamlı ve sayfa numaralı düzenli bir liste oluşturur. Geri al ile eski tasarımınıza dönersiniz.',
  newReportTitle: 'Rapor',
  totalLabel: 'Toplam',
  pageOfFormat: 'Sayfa {0} / {1}',
  issueOutsidePage: 'kağıdın kenarından taşıyor',
  issueFormulaError: 'formülünde hata var: {0}',
  issueUnknownField: 'verilerde olmayan “{0}” alanını kullanıyor',
  issueEmptyFormula: 'formülü boş',
  issueOverlap: '{0} ile üst üste biniyor',
  issueOutsideColumn: 'sütununu aşıp yandaki etikete taşıyor',
  issueCheckDigit: 'kontrol hanesi yanlış (son hane {0} olmalı); okunmaz',
  fixIt: 'Düzelt',
  noProblems: 'Sorun bulunamadı.',
  chartType: 'Grafik türü',
  chartColumn: 'Sütun',
  chartBar: 'Çubuk',
  chartLine: 'Çizgi',
  chartPie: 'Pasta',
  chartDoughnut: 'Halka',
  chartMax: 'Tam çubuk değeri',
  chartDataBar: 'Veri çubuğu',
  chartSparkline: 'Mini çizgi',
  chartRows: 'Satırdaki listeden',
  chartRowsHint: 'Örn. [aylar]: her detay satırında o satırın kendi listesinden küçük bir grafik. Listenin alanlarını Gruplama / Değer olarak yazın (mini çizgide gruplama boş kalabilir).',
  chartCategory: 'Gruplama alanı',
  chartValue: 'Değer',
  chartAggregate: 'Hesaplama',
  aggSum: 'Toplam',
  aggCount: 'Adet',
  aggAvg: 'Ortalama',
  aggMin: 'En küçük',
  aggMax: 'En büyük',
  chartTitle: 'Başlık',
  showValues: 'Değerleri göster',
  showLegend: 'Açıklamayı göster',
  chartHint: 'Grafik bulunduğu bölümün satırlarını gösterir: rapor başlığı veya altlığında tüm satırları, grup altlığında grubun satırlarını.',
  crosstabHint: 'Çapraz tablo bulunduğu bölümün satırlarını özetler: bir alanın her değeri bir satır, diğerinin her değeri bir sütun olur. Rapor başlığı veya altlığında tüm satırları, grup altlığında grubun satırlarını gösterir.',
  crosstabRows: 'Satırlar',
  crosstabColumns: 'Sütunlar',
  crosstabValue: 'Değer',
  crosstabTotals: 'Toplam satırı ve sütunu',
  crosstabTitle: 'Köşe yazısı',
  subreportHint: 'Bu kutunun içine basılan ayrı bir rapor; örneğin her müşterinin altında siparişleri. Kutu satırlarına göre uzar.',
  subreportEdit: 'Alt raporu düzenle…',
  subreportLoad: 'Kayıtlı bir raporu kullan…',
  subreportLoadFailed: 'Dosya bir we-report raporu (.wrpt.json) değil.',
  subreportRows: 'Satırları nereden gelir',
  subreportRowsHint: 'Boş: alt raporun kendi verisi. Her satırın içindeki liste için örneğin [orders] yazın.',
  subreportFilter: 'Yalnızca şu satırları göster',
  subreportFilterHint: 'Örn. [MusteriId] = [^.Id] — [^.alan] kutuyu çevreleyen satırı okur.',
  subreportParams: 'Parametre değerleri',
  subreportTitle: 'Alt rapor: {0}',
  subreportDone: 'Tamam',
  subreportPageHint: 'Alt rapor kutusu kadar geniştir; kağıt ve kenar boşlukları dıştaki rapordan gelir.',
  conditionalFormatting: 'Koşullu biçim',
  watermark: 'Filigran',
  firstPage: 'İlk sayfa',
  previousPage: 'Önceki sayfa',
  nextPage: 'Sonraki sayfa',
  lastPage: 'Son sayfa',
  pageOf: '/ {0}',
  search: 'Raporda ara',
  matches: '{0} / {1}',
  noMatches: 'Bulunamadı',
  fitPage: 'Tüm sayfa',
  keyboardShortcuts: 'Klavye kısayolları',
  editText: 'Metni düzenle',
  editFormula: 'Formülü düzenle…',
  moveItem: 'Taşı',
  moveFine: '0,1 mm taşı',
  resizeItem: 'Genişlet / daralt, uzat / kısalt',
  nextItem: 'Sonraki / önceki öğe',
  rubberBand: 'Birden çok seç: boş yerde sürükle',
  noSnap: 'Sürüklerken basılı tut: yapışma yok',
  dragCopy: 'Ctrl basılı sürükleyince kopyalar',
  wizardTitle: 'Rapor sihirbazı',
  wizardReportTitle: 'Rapor başlığı',
  wizardColumns: 'Gösterilecek sütunlar',
  noGrouping: 'Gruplama yok',
  wizardTotals: 'Sayı sütunlarının toplamı',
  automatic: 'Otomatik',
  createReport: 'Raporu oluştur',
  issueTextCut: 'Metin kutusuna sığmıyor, kesiliyor.',
  stretch: 'Bölüm uzayınca alta kadar uzat',
  stretchHint: 'Uzayan bir metnin yanındaki hücre kenarlıkları ve sütun çizgileri için.',
  fitToText: 'Boyutu metne sığdır',
  tidyUp: 'Toparla',
  tidyUpHint: 'Öğeleri ızgaraya oturtur, neredeyse aynı satır ya da sütunda olanları hizalar.',
  collapseBand: 'Bölümü daralt',
  expandBand: 'Bölümü genişlet',
  groupByThis: 'Satırları bu değere göre grupla',
  addTotal: 'Bu sütunun toplamını ekle',
  filterFields: 'Alan ara',
  previousMatch: 'Önceki eşleşme',
  nextMatch: 'Sonraki eşleşme',
  zoomLevel: 'Yakınlaştırma',
  sortRows: 'Satırları sırala',
  dataOrder: 'Veri sırası',
  addTextHere: 'Buraya metin ekle',
  fitBandToContent: 'Bölümü içeriğine sığdır',
  thumbnails: 'Sayfa küçük resimleri',
  snapGrid: 'Izgaraya yapıştır (serbest taşımak için Alt basılı tutun)',
  gridOff: 'Izgara yok',
  formatPainter: 'Biçimi kopyala: tıklayın, sonra başka bir öğeye tıklayın (Esc vazgeçer)',
  addByClick: 'Bir öğeye tıklayın (veya bir alana çift tıklayın): seçili bölüme eklenir.',
  resizePanel: 'Boyutlandırmak için sürükleyin, gizlemek için çift tıklayın',
  alignJustify: 'İki yana yasla',
  noSelection: 'Seçili öğe yok',
  formatBar: 'Biçim',
  allBorders: 'Dört kenara çerçeve',
  noBorder: 'Çerçeve yok',
  innerList: 'İç liste',
  innerListOf: 'Her satırın içindeki liste',
  innerListHint: 'Her satırın içindeki listenin her öğesi için tekrarlanır; örneğin müşterinin siparişleri. [alan] öğeyi, [^.alan] dıştaki satırı okur.',
  innerFields: 'İç liste alanları',
  tableSection: 'Tablo',
  addRow: 'Satır ekle',
  addColumn: 'Sütun ekle',
  deleteRow: 'Satırı sil',
  deleteColumn: 'Sütunu sil',
  mergeCells: 'Sonrakiyle birleştir',
  splitCell: 'Böl',
  selectedCell: 'Seçili hücre',
  columnWidth: 'Sütun genişliği (mm)',
  rowHeight: 'Satır yüksekliği (mm)',
  tableHint: 'Düzenlemek için bir hücreye tıklayın. Bir veri alanını hücreye bırakınca değeri orada görünür.',
  columnN: 'Sütun {0}',
  labelSheet: 'Etiket kağıdı',
  labelSheetChoose: 'Bir kağıt seçin…',
  labelSheetHint: 'Kağıdı, kenar boşluklarını ve etiket boyutunu ayarlar. Sayfa ve rapor başlık/altlıkları kaldırılır; geri al ile geri gelir.',
  labelsCount: '{0} etiket',
  columnsCount: 'Yan yana',
  columnGap: 'Aradaki boşluk (mm)',
  columnsHint: 'Satırları yan yana basar; örneğin etiket veya kart. Birini tasarlayın; gölgeli alan diğerlerinin yerini gösterir.',
  repeatsAcross: '×{0} tekrarlanır',
  reportLocale: 'Dil ve bölge',
  reportLocaleRegion: 'Sayı ve tarihler',
  reportCurrency: 'Para birimi',
  reportLocaleDefault: 'Uygulama ayarı',
  reportLocaleHint: 'Bu rapor nerede yazdırılırsa yazdırılsın sayıları, tarihleri, parayı ve yazıyla tutarı nasıl yazacağı.',
  formulaEditor: 'Formül düzenleyici',
  formulaEditorHint: 'Bir alana veya fonksiyona tıklayınca imlecin olduğu yere eklenir.',
  formulaResult: 'İlk satır için sonuç',
  formulaEmpty: '(boş)',
  apply: 'Uygula',
  cancel: 'Vazgeç',
  fnLogic: 'Mantık',
  fnText: 'Metin',
  fnNumber: 'Sayı',
  fnDate: 'Tarih',
  fnAggregate: 'Toplamlar',
  functions: 'Fonksiyonlar',
  openFormulaEditor: 'Formül düzenleyiciyi aç',
  functionHelp: {
    Iif: 'İki değer arasında seçer: koşul doğruysa ilki, değilse ikincisi.',
    IsNull: 'Değer boşsa yerine konacak değeri verir.',
    Switch: 'İlk eşleşenin sonucunu verir; örn. Switch([Durum], 1, \'Açık\', 2, \'Kapalı\', \'Diğer\').',
    In: 'Değer diğerlerinden biriyse doğru; örn. In([Sehir], \'Ankara\', \'İzmir\').',
    Concat: 'Metinleri birleştirir.',
    Len: 'Karakter sayısı.',
    Upper: 'BÜYÜK HARF (Türkçe İ/ı doğru).',
    Lower: 'küçük harf (Türkçe İ/ı doğru).',
    Trim: 'Baştaki ve sondaki boşlukları siler.',
    Substring: 'Metnin bir parçası; konum 0 ilk karakterdir.',
    Replace: 'Bir metnin geçtiği her yeri değiştirir.',
    Contains: 'Metin parçayı içeriyorsa doğru.',
    StartsWith: 'Metin parçayla başlıyorsa doğru.',
    EndsWith: 'Metin parçayla bitiyorsa doğru.',
    ToString: 'Değeri metne çevirir.',
    Format: 'Değeri bir kalıpla gösterir; örn. \'n2\' veya \'dd.MM.yyyy\'.',
    AmountInWords: 'Tutarı para birimiyle yazıyla yazar; fatura ve çekler için.',
    NumberToWords: 'Tam sayıyı yazıyla yazar.',
    Round: 'Verilen ondalık basamağa yuvarlar.',
    Abs: 'Sayının işaretsiz hâli.',
    Floor: 'Aşağı yuvarlar.',
    Ceiling: 'Yukarı yuvarlar.',
    ToNumber: 'Metinden sayı okur.',
    Today: 'Yazdırma tarihi (saatsiz).',
    Now: 'Yazdırma tarihi ve saati.',
    Year: 'Tarihin yılı.',
    Month: 'Tarihin ayı (1–12).',
    Day: 'Ayın günü.',
    AddDays: 'Tarihe gün ekler; örn. vade tarihi.',
    AddMonths: 'Tarihe ay ekler; ayın 31’i kısa ayda ayın son günü olur.',
    AddYears: 'Tarihe yıl ekler.',
    DateDiff: 'İki tarih arasındaki tam gün, ay veya yıl; örn. geciken gün: DateDiff(\'day\', [vade], Today()).',
    Left: 'Metnin baştaki karakterleri.',
    Right: 'Metnin sondaki karakterleri.',
    PadLeft: 'Metni soldan belirli uzunluğa tamamlar; örn. PadLeft([no], 6, \'0\') → 000042.',
    Sum: 'Kapsamdaki satırların toplamı (grup, sayfa veya rapor).',
    RowNumber: 'Satırın sıra numarası: 1, 2, 3 … (her grupta yeniden başlar).',
    RunningSum: 'Şimdiye kadarki toplam: satırda o satıra kadarki (her grupta yeniden başlar), sayfa altlığında sayfa sonuna kadarki tüm satırların toplamı (nakli yekün).',
    CarriedSum: 'Önceki sayfalardaki satırların toplamı — sayfa başlığında “devreden”.',
    Count: 'Kapsamdaki satır sayısı.',
    Avg: 'Kapsamdaki satırların ortalaması.',
    Min: 'Kapsamdaki en küçük değer (veya iki değerden küçüğü).',
    Max: 'Kapsamdaki en büyük değer (veya iki değerden büyüğü).',
  },
  watermarkHint: 'Her sayfanın arkasında büyük, soluk yazı; örneğin TASLAK veya ÖDENDİ. Veriden de gelebilir.',
  watermarkAngle: 'Yön',
  conditionalHint: 'Bir koşul doğru olduğunda görünümü değiştirin; örneğin eksi tutarlar kırmızı olsun.',
  addRule: 'Kural ekle',
  ruleWhen: 'Şu durumda',
  ruleThen: 'O zaman',
  removeRule: 'Kuralı kaldır',
  opContains: 'içeriyorsa',
  ruleValue: 'Değer',
};

export const WE_REPORT_LOCALE = new InjectionToken<WeReportLocale>('WE_REPORT_LOCALE', {
  providedIn: 'root',
  factory: () => weReportLocaleEn,
});
