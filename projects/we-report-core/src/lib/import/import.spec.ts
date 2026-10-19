import { loadTestFonts } from '../../testing/test-fonts';
import { checkReport } from '../definition/check';
import { TableControl, TextControl } from '../definition/report-definition';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from '../layout/engine';
import { TextItem } from '../layout/layout-types';
import { colorFrom, formatFrom, pageFor } from './common';
import { importReport } from './import-report';
import { rdlSize, vbToFormula } from './rdlc';
import { devExpressToFormula } from './repx';
import { parseXml, textAt } from './xml';

const RDLC = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <DataSources><DataSource Name="Shop"><ConnectionProperties><DataProvider>System.Data.DataSet</DataProvider><ConnectString>/* Local */</ConnectString></ConnectionProperties></DataSource></DataSources>
  <DataSets>
    <DataSet Name="Lines">
      <Query><DataSourceName>Shop</DataSourceName><CommandText>/* Local Query */</CommandText></Query>
      <Fields>
        <Field Name="Product"><DataField>product_name</DataField><rd:TypeName>System.String</rd:TypeName></Field>
        <Field Name="Qty"><DataField>qty</DataField></Field>
        <Field Name="Price"><DataField>price</DataField></Field>
      </Fields>
    </DataSet>
  </DataSets>
  <ReportParameters>
    <ReportParameter Name="Customer"><DataType>String</DataType><Prompt>Customer</Prompt><DefaultValue><Values><Value>Ayşe &amp; Co</Value></Values></DefaultValue></ReportParameter>
  </ReportParameters>
  <ReportSections><ReportSection>
    <Body>
      <ReportItems>
        <Textbox Name="Title">
          <Paragraphs><Paragraph><TextRuns><TextRun><Value>="Invoice for " &amp; Parameters!Customer.Value</Value><Style><FontFamily>Arial</FontFamily><FontSize>16pt</FontSize><FontWeight>Bold</FontWeight><Color>SteelBlue</Color></Style></TextRun></TextRuns><Style><TextAlign>Center</TextAlign></Style></Paragraph></Paragraphs>
          <Top>0in</Top><Left>0in</Left><Height>0.4in</Height><Width>6in</Width>
        </Textbox>
        <Tablix Name="LinesTable">
          <TablixBody>
            <TablixColumns><TablixColumn><Width>3in</Width></TablixColumn><TablixColumn><Width>1in</Width></TablixColumn><TablixColumn><Width>2in</Width></TablixColumn></TablixColumns>
            <TablixRows>
              <TablixRow><Height>0.25in</Height><TablixCells>
                <TablixCell><CellContents><Textbox Name="H1"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Product</Value><Style><FontWeight>Bold</FontWeight></Style></TextRun></TextRuns></Paragraph></Paragraphs><Style><Border><Style>Solid</Style><Color>LightGrey</Color><Width>1pt</Width></Border><BackgroundColor>#EEEEEE</BackgroundColor></Style></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="H2"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Qty</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="H3"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Amount</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
              </TablixCells></TablixRow>
              <TablixRow><Height>0.25in</Height><TablixCells>
                <TablixCell><CellContents><Textbox Name="Product"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Product.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="Qty"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Qty.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="Amount"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Qty.Value * Fields!Price.Value</Value><Style><Format>N2</Format></Style></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
              </TablixCells></TablixRow>
              <TablixRow><Height>0.25in</Height><TablixCells>
                <TablixCell><CellContents><Textbox Name="TotalLabel"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Total</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox><ColSpan>2</ColSpan></CellContents></TablixCell>
                <TablixCell />
                <TablixCell><CellContents><Textbox Name="Total"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Sum(Fields!Qty.Value * Fields!Price.Value, "Lines")</Value><Style><Format>C2</Format></Style></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
              </TablixCells></TablixRow>
            </TablixRows>
          </TablixBody>
          <TablixColumnHierarchy><TablixMembers><TablixMember /><TablixMember /><TablixMember /></TablixMembers></TablixColumnHierarchy>
          <TablixRowHierarchy><TablixMembers>
            <TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember>
            <TablixMember><Group Name="Details" /></TablixMember>
            <TablixMember />
          </TablixMembers></TablixRowHierarchy>
          <DataSetName>Lines</DataSetName>
          <Top>0.6in</Top><Left>0in</Left><Height>0.75in</Height><Width>6in</Width>
        </Tablix>
        <Line Name="Rule"><Top>1.5in</Top><Left>0in</Left><Height>0in</Height><Width>6in</Width><Style><Border><Style>Solid</Style><Color>Gray</Color><Width>0.5pt</Width></Border></Style></Line>
        <Chart Name="SalesChart"><Top>1.7in</Top><Left>0in</Left><Height>2in</Height><Width>3in</Width></Chart>
      </ReportItems>
      <Height>3.8in</Height>
    </Body>
    <Width>6in</Width>
    <Page>
      <PageHeader><Height>0.3in</Height><ReportItems>
        <Textbox Name="PageNo"><Paragraphs><Paragraph><TextRuns><TextRun><Value>="Page " &amp; Globals!PageNumber &amp; " of " &amp; Globals!TotalPages</Value></TextRun></TextRuns></Paragraph></Paragraphs><Top>0in</Top><Left>4in</Left><Height>0.25in</Height><Width>2in</Width></Textbox>
      </ReportItems></PageHeader>
      <PageHeight>29.7cm</PageHeight><PageWidth>21cm</PageWidth>
      <LeftMargin>2cm</LeftMargin><RightMargin>2cm</RightMargin><TopMargin>1.5cm</TopMargin><BottomMargin>1.5cm</BottomMargin>
    </Page>
  </ReportSection></ReportSections>
</Report>`;

const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v23.2" Name="SalesReport" DisplayName="Sales" Margins="50, 50, 60, 60" PaperKind="A4" PageWidth="827" PageHeight="1169" Font="Arial, 9.75pt" DataMember="Orders">
  <Parameters><Item1 Ref="2" Name="minAmount" Description="Minimum amount" Type="#Ref-3" ValueInfo="100" /></Parameters>
  <CalculatedFields><Item1 Ref="4" Name="LineTotal" Expression="[Qty] * [Price]" /></CalculatedFields>
  <StyleSheet><Item1 Ref="5" Name="Header" Font="Arial, 12pt, style=Bold" ForeColor="0, 70, 140" BackColor="WhiteSmoke" /></StyleSheet>
  <Bands>
    <Item1 Ref="6" ControlType="TopMarginBand" Name="TopMargin" HeightF="60" />
    <Item2 Ref="7" ControlType="PageHeaderBand" Name="PageHeader" HeightF="40">
      <Controls>
        <Item1 Ref="8" ControlType="XRLabel" Name="title" Text="Sales &amp; returns" LocationFloat="0, 0" SizeF="400, 30" StyleName="Header" TextAlignment="MiddleLeft" />
        <Item2 Ref="9" ControlType="XRPageInfo" Name="pageInfo" PageInfo="NumberOfTotal" TextFormatString="Page {0} of {1}" LocationFloat="527, 0" SizeF="200, 23" TextAlignment="TopRight" />
      </Controls>
    </Item2>
    <Item3 Ref="10" ControlType="GroupHeaderBand" Name="CityHeader" HeightF="30" Level="0">
      <GroupFields><Item1 Ref="11" FieldName="City" SortOrder="Descending" /></GroupFields>
      <Controls>
        <Item1 Ref="12" ControlType="XRLabel" Name="city" LocationFloat="0, 5" SizeF="300, 23" Font="Arial, 11pt, style=Bold">
          <ExpressionBindings><Item1 Ref="13" EventName="BeforePrint" PropertyName="Text" Expression="'City: ' + [City]" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="14" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="15" ControlType="XRTable" Name="row" LocationFloat="0, 0" SizeF="600, 25" Borders="All" BorderColor="Silver">
          <Rows><Item1 Ref="16" ControlType="XRTableRow" Name="r1" Weight="1"><Cells>
            <Item1 Ref="17" ControlType="XRTableCell" Name="c1" Weight="2"><ExpressionBindings><Item1 Ref="18" EventName="BeforePrint" PropertyName="Text" Expression="[Product]" /></ExpressionBindings></Item1>
            <Item2 Ref="19" ControlType="XRTableCell" Name="c2" Weight="1" TextFormatString="{0:N2}" TextAlignment="TopRight"><ExpressionBindings><Item1 Ref="20" EventName="BeforePrint" PropertyName="Text" Expression="[LineTotal]" /></ExpressionBindings></Item2>
          </Cells></Item1></Rows>
        </Item1>
        <Item2 Ref="21" ControlType="XRBarCode" Name="code" LocationFloat="610, 0" SizeF="117, 25" ShowText="false">
          <Symbology Ref="22" ControlType="DevExpress.XtraPrinting.BarCode.Code128Generator, DevExpress.Printing.v23.2.Core" />
          <ExpressionBindings><Item1 Ref="23" EventName="BeforePrint" PropertyName="Text" Expression="[Code]" /></ExpressionBindings>
        </Item2>
      </Controls>
    </Item4>
    <Item5 Ref="24" ControlType="GroupFooterBand" Name="CityFooter" HeightF="30" Level="0">
      <Controls>
        <Item1 Ref="25" ControlType="XRLabel" Name="cityTotal" LocationFloat="400, 0" SizeF="200, 23" TextFormatString="Total: {0:C2}">
          <Summary Ref="26" Running="Group" />
          <ExpressionBindings><Item1 Ref="27" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([LineTotal])" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item5>
    <Item6 Ref="28" ControlType="DetailReportBand" Name="Returns" DataMember="Orders.Returns" Level="0">
      <Bands><Item1 Ref="29" ControlType="DetailBand" Name="ReturnRow" HeightF="20"><Controls>
        <Item1 Ref="30" ControlType="XRLabel" Name="reason" LocationFloat="20, 0" SizeF="300, 20"><ExpressionBindings><Item1 Ref="31" EventName="BeforePrint" PropertyName="Text" Expression="[Reason]" /></ExpressionBindings></Item1>
      </Controls></Item1></Bands>
    </Item6>
    <Item7 Ref="32" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="60" />
    <Item8 Ref="33" ControlType="XRChart" Name="chart" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('report import', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('reads XML with namespaces, entities, CDATA and comments', () => {
    const root = parseXml(`<?xml version="1.0"?><!-- c --><a:Root xmlns:a="x" k="1 &amp; 2"><b>&lt;x&gt; &#x131;</b><c><![CDATA[<raw>]]></c><d/></a:Root>`);
    expect(root.name).toBe('Root');
    expect(root.attrs['k']).toBe('1 & 2');
    expect(textAt(root, 'b')).toBe('<x> ı');
    expect(textAt(root, 'c')).toBe('<raw>');
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c', 'd']);
    expect(() => parseXml('<a><b></a>')).toThrow();
  });

  it('converts sizes, colours, formats and paper', () => {
    expect(rdlSize('1in')).toBeCloseTo(25.4, 5);
    expect(rdlSize('2.5cm')).toBeCloseTo(25, 5);
    expect(rdlSize('12pt')).toBeCloseTo(4.2333, 3);
    expect([colorFrom('SteelBlue'), colorFrom('0, 70, 140'), colorFrom('#ABC'), colorFrom('Transparent')]).toEqual(['#4682b4', '#00468c', '#aabbcc', undefined]);
    expect([formatFrom('N2'), formatFrom('C'), formatFrom('P0'), formatFrom('d'), formatFrom('#,##0.00'), formatFrom('dd/MM/yyyy')]).toEqual(['n2', 'c2', 'p0', 'dd.MM.yyyy', 'n2', 'dd/MM/yyyy']);
    expect(pageFor(297, 210, { top: 10, right: 10, bottom: 10, left: 10 })).toEqual(jasmine.objectContaining({ paper: 'A4', orientation: 'landscape' }));
    expect(pageFor(100, 50, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual(jasmine.objectContaining({ paper: 'custom', width: 50, height: 100 }));
  });

  it('translates VB and DevExpress expressions', () => {
    const fields = new Map([['Product', 'product_name']]);
    expect(vbToFormula('=Fields!Product.Value & " (" & Parameters!Unit.Value & ")"', fields)).toEqual({ expression: '[product_name] + " (" + [?Unit] + ")"' });
    expect(vbToFormula('=IIF(Fields!Qty.Value > 10, "Bulk & more", Nothing)')).toEqual({ expression: 'Iif([Qty] > 10, "Bulk & more", null)' });
    expect(vbToFormula('=Sum(Fields!A.Value, "DataSet1")')).toEqual({ expression: 'Sum([A])' });
    expect(vbToFormula('=IIF(Fields!A.Value > 0, "yes", "no")')).toEqual({ expression: 'Iif([A] > 0, "yes", "no")' });
    expect(vbToFormula('=Format(Fields!D.Value, "dd.MM.yyyy")')).toEqual({ expression: "Format([D], 'dd.MM.yyyy')" });
    expect(vbToFormula('=Code.Total()')).toBeNull();
    expect(vbToFormula('Plain text')).toBe('Plain text');
    expect(devExpressToFormula('sumSum([LineTotal])', new Map([['LineTotal', '[Qty] * [Price]']]))).toBe('Sum(([Qty] * [Price]))');
    expect(devExpressToFormula('Iif(?minAmount > [Parameters.x], GetYear([D]), ToStr([N]))')).toBe('Iif([?minAmount] > [?x], Year([D]), ToString([N]))');
    expect(devExpressToFormula('sumCount([Id])')).toBe('Count()');
    expect(devExpressToFormula('sumRunningSum([A])')).toBeNull();
  });

  it('imports an RDLC report: page, header, table split into header/detail/total rows, parameters', () => {
    const { report, warnings } = importReport(RDLC, 'Invoice.rdlc');
    expect(report.name).toBe('Invoice');
    expect(report.page).toEqual(jasmine.objectContaining({ paper: 'A4', orientation: 'portrait', margins: { top: 15, right: 20, bottom: 15, left: 20 } }));
    expect(report.bands.map((b) => b.kind)).toEqual(['pageHeader', 'reportHeader', 'detail', 'reportFooter']);
    expect(report.bands[0].controls[0]).toEqual(jasmine.objectContaining({ type: 'pageInfo', info: 'pageNofM', format: 'Page {0} of {1}' }));
    const title = report.bands[1].controls[0] as TextControl;
    expect(title.text).toEqual({ expression: '"Invoice for " + [?Customer]' });
    expect(title.styleOverrides).toEqual(jasmine.objectContaining({ fontFamily: 'Arial', fontSize: 16, bold: true, color: '#4682b4', textAlign: 'center' }));
    const header = report.bands[1].controls[1] as TableControl;
    expect(header.columns).toEqual([76.2, 25.4, 50.8]);
    expect(header.rows[0].cells.map((c) => c.text)).toEqual(['Product', 'Qty', 'Amount']);
    expect(header.rows[0].cells[0].styleOverrides).toEqual(jasmine.objectContaining({ bold: true, backgroundColor: '#eeeeee', border: jasmine.objectContaining({ color: '#d3d3d3' }) }));
    const detail = report.bands[2].controls[0] as TableControl;
    expect(detail.rows[0].cells.map((c) => c.text)).toEqual([{ expression: '[product_name]' }, { expression: '[qty]' }, { expression: '[qty] * [price]' }]);
    expect(detail.rows[0].cells[2].format).toBe('n2');
    const total = report.bands[3].controls[0] as TableControl;
    expect(total.rows[0].cells.map((c) => c.colSpan ?? 1)).toEqual([2, 1]);
    expect(total.rows[0].cells[1]).toEqual(jasmine.objectContaining({ text: { expression: 'Sum([qty] * [price])' }, format: 'c2' }));
    expect(report.bands[3].controls.some((c) => c.type === 'line')).toBeTrue();
    expect(report.parameters).toEqual([{ name: 'Customer', type: 'string', label: 'Customer', defaultValue: 'Ayşe & Co' }]);
    expect(warnings.join(' ')).toContain('Chart "SalesChart"');
    expect(checkReport(report).filter((i) => i.severity === 'error')).toEqual([]);

    // With the data added, it prints.
    report.dataSources[0] = { ...report.dataSources[0], kind: 'json', data: [{ product_name: 'Çay', qty: 2, price: 10 }, { product_name: 'Kahve', qty: 1, price: 30 }] } as never;
    const texts = layoutReport(report, { fonts, now: new Date(2026, 9, 19), locale: 'en-US', currency: 'USD' }).pages[0].items
      .filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' '));
    expect(texts).toEqual(jasmine.arrayContaining(['Invoice for Ayşe & Co', 'Çay', 'Kahve', '20.00', '30.00', '$50.00', 'Page 1 of 1']));
  });

  it('imports a DevExpress layout: styles, groups, tables, summaries, detail reports', () => {
    const { report, warnings } = importReport(REPX, 'Sales.repx');
    expect(report.name).toBe('Sales');
    expect(report.page).toEqual(jasmine.objectContaining({ paper: 'A4', margins: { left: 12.7, right: 12.64, top: 15.24, bottom: 15.31 } }));
    expect(report.styles['Header']).toEqual(jasmine.objectContaining({ fontFamily: 'Arial', fontSize: 12, bold: true, color: '#00468c', backgroundColor: '#f5f5f5' }));
    expect(report.dataMember).toEqual({ dataSourceId: 'data', path: 'Orders' });
    expect(report.bands.map((b) => b.kind)).toEqual(['pageHeader', 'groupHeader', 'detail', 'subDetail', 'groupFooter']);
    const [page, group, detail, inner, footer] = report.bands;
    expect(page.controls[0]).toEqual(jasmine.objectContaining({ type: 'text', text: 'Sales & returns', style: 'Header' }));
    expect(page.controls[1]).toEqual(jasmine.objectContaining({ type: 'pageInfo', info: 'pageNofM', format: 'Page {0} of {1}' }));
    expect(group).toEqual(jasmine.objectContaining({ groupBy: { expression: '[City]' }, sort: 'desc' }));
    expect(footer.groupHeaderId).toBe(group.id);
    const table = detail.controls[0] as TableControl;
    expect(table.columns).toEqual([101.6, 50.8]);
    expect(table.rows[0].cells[1]).toEqual(jasmine.objectContaining({ text: { expression: '([Qty] * [Price])' }, format: 'n2' }));
    expect(table.styleOverrides?.border?.color).toBe('#c0c0c0');
    expect(detail.controls[1]).toEqual(jasmine.objectContaining({ type: 'barcode', symbology: 'code128', value: { expression: '[Code]' }, showText: false }));
    expect((footer.controls[0] as TextControl).text).toEqual({ expression: "'Total: ' + Format(Sum(([Qty] * [Price])), 'c2')" });
    expect(inner).toEqual(jasmine.objectContaining({ rowsPath: 'Returns' }));
    expect(report.parameters).toEqual([{ name: 'minAmount', type: 'string', label: 'Minimum amount', defaultValue: '100' }]);
    expect(warnings.join(' ')).toContain('XRChart');
    expect(checkReport(report).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses unknown files and code-based .repx with a clear message', () => {
    expect(() => importReport('hello', 'x.txt')).toThrowError(/Unknown report file/);
    expect(() => importReport('namespace X { class R : XtraReport {} }', 'old.repx')).toThrowError(/saved as code/);
    expect(importReport('{"version":1,"name":"A","page":{"paper":"A4","orientation":"portrait","margins":{"top":1,"right":1,"bottom":1,"left":1},"displayUnit":"mm"},"styles":{},"dataSources":[],"bands":[]}').report.name).toBe('A');
  });
});
