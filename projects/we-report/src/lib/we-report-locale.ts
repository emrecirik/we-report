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
  fixIt: string;
  noProblems: string;
}

export const weReportLocaleEn: WeReportLocale = {
  designerLabel: 'Report design surface',
  bandNames: {
    reportHeader: 'Report header',
    pageHeader: 'Page header',
    groupHeader: 'Group header',
    detail: 'Detail (repeats for every row)',
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
  },

  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  print: 'Print',
  downloadPdf: 'Download PDF',
  downloadExcel: 'Excel',
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
  fixIt: 'Fix',
  noProblems: 'No problems found.',
};

export const weReportLocaleTr: WeReportLocale = {
  designerLabel: 'Rapor tasarım alanı',
  bandNames: {
    reportHeader: 'Rapor başlığı',
    pageHeader: 'Sayfa başlığı',
    groupHeader: 'Grup başlığı',
    detail: 'Detay (her satır için tekrarlanır)',
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
  },

  zoomIn: 'Yakınlaştır',
  zoomOut: 'Uzaklaştır',
  print: 'Yazdır',
  downloadPdf: 'PDF indir',
  downloadExcel: 'Excel',
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
  fixIt: 'Düzelt',
  noProblems: 'Sorun bulunamadı.',
};

export const WE_REPORT_LOCALE = new InjectionToken<WeReportLocale>('WE_REPORT_LOCALE', {
  providedIn: 'root',
  factory: () => weReportLocaleEn,
});
