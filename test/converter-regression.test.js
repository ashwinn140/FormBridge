'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCassCore() {
  const html = fs.readFileSync(require.resolve('../cass-reconciliation.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const source = scripts.map(x => x[1]).find(x => x.includes('CASS reconciliation core'));
  assert.ok(source, 'CASS core script exists');
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, globalThis: {} });
  return mod.exports;
}

function loadVvdnCore() {
  const html = fs.readFileSync(require.resolve('../vvdn-converter.html'), 'utf8');
  const match = html.match(/<script id="core">([\s\S]*?)<\/script>/i);
  assert.ok(match, 'VVDN converter core script exists');
  const context = {};
  vm.runInNewContext(match[1], context);
  return context;
}

function loadAsbCore() {
  const html = fs.readFileSync(require.resolve('../asb-converter.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const source = scripts.map(x => x[1]).find(x => x.includes('ASB International converter core'));
  assert.ok(source, 'ASB core script exists');
  const context = {};
  vm.runInNewContext(source, context);
  return context.FBCORE;
}

function loadAsbTemplate() {
  const html = fs.readFileSync(require.resolve('../asb-converter.html'), 'utf8');
  const line = html.split('\n').find(x => x.startsWith('var TEMPLATE = '));
  assert.ok(line, 'ASB 26-sheet template declaration exists');
  return vm.runInNewContext(line.slice('var TEMPLATE = '.length, -1));
}

function makeTemplateWorkbook(template) {
  const colName = n => {
    let out = '';
    for (n += 1; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out;
  };
  const colNumber = name => {
    let out = 0;
    for (const ch of name) out = out * 26 + ch.charCodeAt(0) - 64;
    return out - 1;
  };
  const encodeCell = ({ r, c }) => colName(c) + (r + 1);
  const decodeRange = ref => {
    const [a, b = a] = ref.split(':');
    const parse = cell => {
      const m = cell.match(/^([A-Z]+)(\d+)$/);
      return { c: colNumber(m[1]), r: Number(m[2]) - 1 };
    };
    return { s: parse(a), e: parse(b) };
  };
  const Sheets = {};
  template.forEach(([name, headers]) => {
    const ws = {};
    headers.forEach((h, c) => { ws[encodeCell({ r: 0, c })] = { t: 's', v: h }; });
    ws['!ref'] = 'A1:' + colName(headers.length - 1) + '1';
    Sheets[name] = ws;
  });
  return {
    Sheets,
    SheetNames: template.map(x => x[0]),
    XLSX: { utils: { encode_cell: encodeCell, decode_range: decodeRange, encode_col: colName } }
  };
}

test('browser file parsers use patched SheetJS and disable PDF.js eval support', () => {
  const read = path => fs.readFileSync(require.resolve('../' + path), 'utf8');
  const spreadsheetPages = [
    'anu-worles-converter.html',
    'anu-worles-tech-converter.html',
    'seco-converter.html',
    'vvdn-converter.html',
    'asb-converter.html'
  ];
  for (const page of spreadsheetPages) {
    const html = read(page);
    assert.match(html, /cdn\\.sheetjs\\.com\\/xlsx-0\\.20\\.3\\/package\\/dist\\/xlsx\\.full\\.min\\.js/, page + ' uses patched SheetJS');
    assert.doesNotMatch(html, /xlsx\\/0\\.18\\.5\\/xlsx\\.full\\.min\\.js/, page + ' must not load vulnerable SheetJS 0.18.5');
  }
  const pdfPages = ['sandvik-converter.html', 'vvdn-converter.html', 'asb-converter.html'];
  for (const page of pdfPages) {
    const html = read(page);
    assert.match(html, /isEvalSupported['"]?\\s*:\\s*false/, page + ' disables PDF.js eval support');
  }
});

test('CASS parses negative amounts represented with a trailing minus', () => {
  const core = loadCassCore();
  assert.equal(core.toNum('1,234.50-'), -1234.5);
  assert.equal(core.toNum('1,234.50'), 1234.5);
});

test('CASS flags an AWB billed more than once across loaded bills', () => {
  const core = loadCassCore();
  const makeBill = (invoiceNo, bill) => ({
    fileName: bill,
    meta: { iata: '123 2026/2027', periodFrom: '2026-11-01', periodTo: '2026-11-30', netDue: 100, adjustment: false },
    invoices: [{ invoiceNo, airlineCode: '123', rows: [{ awb11: '12345678901', invoiceNo, adj: false, cassIssues: [] }] }],
    rows: [{}], statement: [], warnings: [], notes: []
  });
  const merged = core.mergeCass([makeBill('INV-A', 'bill-a.pdf'), makeBill('INV-B', 'bill-b.pdf')]);
  assert.equal(merged.rows.length, 2);
  assert.ok(merged.rows.every(row => row.cassIssues.some(issue => issue.code === 'cass_dup')));
});

test('CASS adjustment nets DL reversal and AD re-bill, retaining corrected weight', () => {
  const core = loadCassCore();
  const rows = core.combineCassAdjustmentRows([
    { serial: '12345678', sp: 'DL', weight: 500, wtCharge: -5000, otherCharges: -200, commission: -100, netBefore: -5100, netPayable: -5610, taxCol: -510, tdsComm: 0, tdsFreight: 0, gst: { taxable: -5100, total: -5100, cgst: -255, utgst: 0, sgst: -255, igst: 0, gst: -510 }, cassIssues: [] },
    { serial: '12345678', sp: 'AD', weight: 600, wtCharge: 6600, otherCharges: 300, commission: 100, netBefore: 6800, netPayable: 7480, taxCol: 680, tdsComm: 0, tdsFreight: 0, gst: { taxable: 6800, total: 6800, cgst: 340, utgst: 0, sgst: 340, igst: 0, gst: 680 }, cassIssues: [] }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netBefore, 1700);
  assert.equal(rows[0].netPayable, 1870);
  assert.equal(rows[0].weight, 600);
  assert.equal(rows[0].rateBasis, 6800);
  assert.equal(rows[0].sp, 'DL/AD');
  assert.equal(rows[0].gst.gst, 170);
});
test('CASS credit-only adjustment remains a negative credit with absolute weight', () => {
  const core = loadCassCore();
  const rows = core.combineCassAdjustmentRows([
    { serial: '87654321', sp: 'DL', weight: -250, wtCharge: -2500, otherCharges: 0, commission: 0, netBefore: -2500, netPayable: -2950, taxCol: -450, tdsComm: 0, tdsFreight: 0, gst: { taxable: -2500, total: -2500, cgst: -225, utgst: 0, sgst: -225, igst: 0, gst: -450 }, cassIssues: [] }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netBefore, -2500);
  assert.equal(rows[0].netPayable, -2950);
  assert.equal(rows[0].weight, 250);
  assert.equal(rows[0].rateBasis, null);
  assert.equal(rows[0].adjAD, null);
});
test('CASS adjustment with repeated DL/AD lines is explicitly flagged', () => {
  const core = loadCassCore();
  const base = { serial: '11223344', weight: 100, wtCharge: 100, otherCharges: 0, commission: 0, netBefore: 100, netPayable: 100, taxCol: 0, tdsComm: 0, tdsFreight: 0, cassIssues: [] };
  const rows = core.combineCassAdjustmentRows([
    { ...base, sp: 'DL' }, { ...base, sp: 'DL' }, { ...base, sp: 'AD' }
  ]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].cassIssues.some(i => i.code === 'cass_adj_duplicate'));
});
test('CASS purchase lookup uses the matching bill when invoice numbers repeat', () => {
  const core = loadCassCore();
  const invoices = [
    { invoiceNo: 'INV-42', bill: '123 2026/2027', invoiceDate: '2026-11-01', vendorGstin: 'GST-A' },
    { invoiceNo: 'INV-42', bill: '456 2026/2027 adj', invoiceDate: '2026-11-08', vendorGstin: 'GST-B' }
  ];
  const selected = core.findCassInvoice(invoices, { invoiceNo: 'INV-42', bill: '456 2026/2027 adj' });
  assert.equal(selected.vendorGstin, 'GST-B');
  assert.equal(selected.invoiceDate, '2026-11-08');
  assert.equal(core.findCassInvoice(invoices, { invoiceNo: 'INV-42', bill: 'unknown bill' }), null);
  assert.equal(core.findCassInvoice(invoices, { invoiceNo: 'INV-99', bill: 'unknown bill' }), null);
  assert.equal(core.findCassInvoice([invoices[0]], { invoiceNo: 'INV-42', bill: 'unknown bill' }), invoices[0]);
});

test('CASS purchase upload preserves credit-note signs and flags commission TDS omitted from freight withholding', () => {
  const core = loadCassCore();
  const makePurchase = (netBefore) => {
    const cassRow = {
      awb: '123-45678901', invoiceNo: 'INV-1', bill: 'BILL-1', airlineCode: 'ABC',
      netBefore, netPayable: netBefore + (netBefore < 0 ? -18 : 18),
      weight: 10, wtCharge: netBefore, otherCharges: 0, commission: 0,
      gst: { igst: netBefore < 0 ? -18 : 18, cgst: 0, sgst: 0, utgst: 0, gst: netBefore < 0 ? -18 : 18 },
      tdsFreight: netBefore < 0 ? -2 : 2, tdsComm: netBefore < 0 ? -1 : 1,
      vendorGstin: 'VENDOR-GST', agentGstin: 'AGENT-GST', adj: false
    };
    const cass = { invoices: [{
      invoiceNo: 'INV-1', bill: 'BILL-1', airlineCode: 'ABC', vendorGstin: 'VENDOR-GST',
      invoiceDate: '2026-11-01', periodFrom: '2026-11-01', periodTo: '2026-11-30', remitDate: '2026-12-15'
    }] };
    const res = { rows: [{
      cass: cassRow, status: 'ok', company: 'New Globe', issues: [],
      reg: [{ shipmentNo: 'JOB-1', consol: '', consolJob: '' }]
    }] };
    const masters = {
      vendors: [{ taxId: 'VENDOR-GST', erpName: 'Airline Vendor', branch: 'Mumbai', whCode: 'TDS-FRT' }],
      branches: [{ gstin: 'AGENT-GST', branch: 'Mumbai' }]
    };
    return core.buildPurchase(cass, res, masters, { entryDate: '2026-11-11', postingDate: '2026-11-11' });
  };
  const debit = makePurchase(100);
  assert.equal(debit.rows.length, 1);
  assert.equal(debit.rows[0].row['DR or CR'], 'DR');
  assert.equal(debit.rows[0].row['Charge or GL Amount'], 100);
  assert.equal(debit.rows[0].row['WH Tax Amount'], 2);
  assert.ok(debit.warnings.some(w => /TDS on commission/.test(w)));

  const credit = makePurchase(-100);
  assert.equal(credit.rows.length, 1);
  assert.equal(credit.rows[0].row['DR or CR'], 'CR');
  assert.equal(credit.rows[0].row['Charge or GL Amount'], 100);
  assert.equal(credit.rows[0].row['Taxcode1 Amt'], 18);
  assert.equal(credit.rows[0].row['WH Tax Amount'], 2);
  assert.ok(credit.warnings.some(w => /TDS on commission/.test(w)));
});

test('CASS purchase invoice identity includes bill when invoice numbers repeat', () => {
  const core = loadCassCore();
  const a = { invoiceNo: 'INV-42', bill: '123 2026/2027' };
  const b = { invoiceNo: 'INV-42', bill: '456 2026/2027 adj' };
  assert.equal(core.sameCassInvoice(a, a), true);
  assert.equal(core.sameCassInvoice(a, b), false);
  assert.equal(core.sameCassInvoice({ invoiceNo: 'INV-42' }, { invoiceNo: 'INV-42', bill: 'BILL-2' }), false);
});

test('CASS consolidates house weights and calculates weighted buy/sell rates', () => {
  const core = loadCassCore();
  const cassRow = {
    awb11: '12345678901', serial: '45678901', sp: 'OK', weight: 100,
    netBefore: 2500, netPayable: 2500, adj: false, rateBasis: null,
    cassIssues: [], org: 'BOM', dst: 'LHR', prefix: '123',
    execDate: '2026-11-05', invoiceNo: 'INV-1', bill: 'BILL-1', airlineCode: 'ABC'
  };
  const regRows = [
    { awb11: cassRow.awb11, serial: cassRow.serial, shipmentNo: 'JOB-1', weight: 40, buyRate: 10, sellRate: 30, loadCode: 'BOM', dischCode: 'LHR', status: 'Active', consol: 'Consol', shipDate: '2026-11-05', prefix: '123', airline: 'ABC' },
    { awb11: cassRow.awb11, serial: cassRow.serial, shipmentNo: 'JOB-2', weight: 60, buyRate: 20, sellRate: 40, loadCode: 'BOM', dischCode: 'LHR', status: 'Active', consol: 'Consol', shipDate: '2026-11-05', prefix: '123', airline: 'ABC' }
  ];
  const result = core.reconcile(
    { meta: { periodFrom: '2026-11-01', periodTo: '2026-11-30' }, invoices: [{ invoiceNo: 'INV-1', airlineCode: 'ABC', prefix: '123', bill: 'BILL-1' }], rows: [cassRow] },
    [{ company: 'NGL', scope: { company: 'NGL', from: '2026-10-01', to: '2026-11-30' }, rows: regRows }]
  );
  const row = result.rows[0];
  assert.equal(row.regWeight, 100);
  assert.equal(row.rates.buy, 16);
  assert.equal(row.rates.sell, 36);
  assert.equal(row.rates.buyAmt, 1600);
  assert.equal(row.rates.gainAmt, 1100);
  assert.ok(row.issues.some(issue => issue.code === 'consol'));
});

test('VVDN parser reads device serial rows and reports a missing header', () => {
  const core = loadVvdnCore();
  const parsed = core.parseSheet([
    ['VVDN Export Data'],
    ['S.No', 'Device SN', 'Quantity', 'Unit Price', 'Amount'],
    [1, 'CAM-001', 2, 12.5, 25],
    [2, 'CAM-002', 1, 20, 20]
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].desc, 'CAM-001');
  assert.equal(parsed.lines[0].qty, 2);
  assert.equal(parsed.lines[0].rate, 12.5);
  assert.equal(parsed.lines[0].amount, 25);
  assert.match(core.parseSheet([['No matching columns']]).error, /Could not find the header row/);
});

test('VVDN CSV builder emits the fixed header width and escapes comma-containing descriptions', () => {
  const core = loadVvdnCore();
  const constants = {};
  core.CONST_FIELDS.forEach(field => { constants[field.k] = field.def; });
  constants.prefix = 'CAMERA, SN-';
  const csv = core.buildCsv([{ desc: 'CAM-001', qty: 2, rate: 12.5 }], constants);
  const lines = csv.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, core.HEADER.length);
  assert.ok(lines[1].includes('"CAMERA, SN-CAM-001"'));
  assert.ok(lines[1].includes(',2,'));
  assert.ok(lines[1].includes(',12.5,'));
});

test('ASB 26-sheet structure validator accepts the template and blocks missing or altered sheets', () => {
  const core = loadAsbCore();
  const template = loadAsbTemplate();
  assert.equal(template.length, 26);
  const valid = makeTemplateWorkbook(template);
  const ok = core.transformExcel(valid, valid.XLSX, template, core.DEFAULT_CONFIG, { formulas: false });
  assert.equal(ok.issues.length, 0);
  assert.equal(ok.rowCounts.length, 26);

  const missing = makeTemplateWorkbook(template);
  delete missing.Sheets.ITEMS;
  missing.SheetNames = missing.SheetNames.filter(x => x !== 'ITEMS');
  const missingResult = core.transformExcel(missing, missing.XLSX, template, core.DEFAULT_CONFIG, { formulas: false });
  assert.ok(missingResult.issues.some(x => /Sheet "ITEMS" is missing/.test(x)));

  const altered = makeTemplateWorkbook(template);
  altered.Sheets.GENERAL.A1.v = 'Wrong_Header';
  const alteredResult = core.transformExcel(altered, altered.XLSX, template, core.DEFAULT_CONFIG, { formulas: false });
  assert.ok(alteredResult.issues.some(x => /expected "TransportMode" but found "Wrong_Header"/.test(x)));
});

test('ASB formula generation rejects duplicate invoice serials and currency codes', () => {
  const core = loadAsbCore();
  assert.equal(core.assertPositiveExchangeRate(vm.runInNewContext("({ v: '83.25' })"), 'USD'), 83.25);
  assert.throws(() => core.assertPositiveExchangeRate(vm.runInNewContext("({ v: '0' })"), 'USD'), /must be a positive number/);
  assert.throws(() => core.assertPositiveExchangeRate(vm.runInNewContext("({ v: '-1.5' })"), 'USD'), /must be a positive number/);
  assert.throws(() => core.assertPositiveExchangeRate(vm.runInNewContext("({ v: 'not-a-rate' })"), 'USD'), /must be a positive number/);
  assert.equal(core.assertItemInvoiceReference('INV-1', { 'INV-1': 2 }, 2), 2);
  assert.throws(() => core.assertItemInvoiceReference('INV-X', { 'INV-1': 2 }, 3), /not present on the INVOICES sheet/);
  assert.throws(() => core.assertItemInvoiceReference('', { 'INV-1': 2 }, 4), /not present on the INVOICES sheet/);
  assert.throws(() => core.assertUniqueKeys([{ number: 'INV-1' }, { number: 'INV-1' }], 'number', 'invoice serial number'), /Duplicate invoice serial number/);
  assert.throws(() => core.assertUniqueKeys([{ code: 'USD' }, { code: 'USD' }], 'code', 'exchange-rate currency code'), /Duplicate exchange-rate currency code/);
  assert.throws(() => core.assertUniqueKeys([{ number: 'INV-1' }, { number: '' }], 'number', 'invoice serial number'), /is blank/);
  assert.equal(core.assertUniqueKeys([{ code: 'USD' }, { code: 'INR' }], 'code', 'currency'), true);
});

test('ASB rejects duplicate commercial invoices or packing lists instead of overwriting', () => {
  const core = loadAsbCore();
  const ci = { kind: 'ci', name: 'invoice-1.pdf' };
  const pl = { kind: 'pl', name: 'packing-1.pdf' };
  assert.deepEqual(Object.keys(core.uniqueDocsByKind([ci, pl])).sort(), ['ci', 'pl']);
  assert.throws(
    () => core.uniqueDocsByKind([ci, { kind: 'ci', name: 'invoice-2.pdf' }]),
    /More than one commercial invoice PDF/
  );
  assert.throws(
    () => core.uniqueDocsByKind([pl, { kind: 'pl', name: 'packing-2.pdf' }]),
    /More than one packing list PDF/
  );
});

test('ASB joins invoice and packing-list rows and warns when invoice numbers differ', () => {
  const core = loadAsbCore();
  const cfg = JSON.parse(JSON.stringify(core.DEFAULT_CONFIG));
  const ci = {
    invoiceNo: 'CI-100', invoiceDate: '04.11.2026', mode: 'AIR',
    consigneeName: 'Buyer Ltd', consigneeAddress: 'Conakry',
    consigneeCountryName: 'Guinea', hasBuyer: false, buyerCountryName: '',
    portOfDischarge: 'CONAKRY', finalDestCountryName: 'Guinea',
    finalDestination: '', delivery: 'FOB', paymentTerms: 'WITHIN 30 DAYS',
    currency: 'USD', exchangeRate: '83.2', freightTotal: 0, invoiceTotal: 200,
    items: [{ sr: 1, heading: '', name: 'MOLD', hsn: '84779000', unit: 'EA', qty: '2', rate: '100', amount: '200' }]
  };
  const pl = {
    invoiceNo: 'CI-101', rows: [{ name: 'MOLD', nw: 5 }],
    packagesCount: 1, totalGW: 6, totalNW: 5
  };
  const model = core.buildModel(ci, pl, cfg, { GUINEA: 'GN' });
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].netWeight, 5);
  assert.equal(model.net, 5);
  assert.ok(model.warnings.some(w => w.includes('Invoice number differs')));
});

test('ASB maps repeated item descriptions to separate packing-list rows', () => {
  const core = loadAsbCore();
  const cfg = JSON.parse(JSON.stringify(core.DEFAULT_CONFIG));
  const ci = {
    invoiceNo: 'CI-200', invoiceDate: '04.11.2026', mode: 'AIR',
    consigneeName: 'Buyer Ltd', consigneeAddress: 'Conakry',
    consigneeCountryName: 'Guinea', hasBuyer: false, buyerCountryName: '',
    portOfDischarge: 'CONAKRY', finalDestCountryName: 'Guinea',
    finalDestination: '', delivery: 'FOB', paymentTerms: 'WITHIN 30 DAYS',
    currency: 'USD', exchangeRate: '83.2', freightTotal: 0, invoiceTotal: 300,
    items: [
      { sr: 1, heading: '', name: 'MOLD A', hsn: '84779000', unit: 'EA', qty: '1', rate: '100', amount: '100' },
      { sr: 2, heading: '', name: 'MOLD A', hsn: '84779000', unit: 'EA', qty: '2', rate: '100', amount: '200' }
    ]
  };
  const pl = {
    invoiceNo: 'CI-200',
    rows: [{ name: 'MOLD A', nw: 2 }, { name: 'MOLD A', nw: 3 }],
    packagesCount: 1, totalGW: 6, totalNW: 5
  };
  const model = core.buildModel(ci, pl, cfg, { GUINEA: 'GN' });
  assert.deepEqual(model.items.map(x => x.netWeight), [2, 3]);
});

test('ASB warns when it has to match an invoice line to a differently named packing-list row by position', () => {
  const core = loadAsbCore();
  const cfg = JSON.parse(JSON.stringify(core.DEFAULT_CONFIG));
  const ci = {
    invoiceNo: 'CI-300', invoiceDate: '04.11.2026', mode: 'AIR',
    consigneeName: 'Buyer Ltd', consigneeAddress: 'Conakry',
    consigneeCountryName: 'Guinea', hasBuyer: false, buyerCountryName: '',
    portOfDischarge: 'CONAKRY', finalDestCountryName: 'Guinea',
    finalDestination: '', delivery: 'FOB', paymentTerms: 'WITHIN 30 DAYS',
    currency: 'USD', exchangeRate: '83.2', freightTotal: 0, invoiceTotal: 100,
    items: [{ sr: 1, heading: '', name: 'MOLD A', hsn: '84779000', unit: 'EA', qty: '1', rate: '100', amount: '100' }]
  };
  const pl = { invoiceNo: 'CI-300', rows: [{ name: 'DIFFERENT PRODUCT', nw: 4 }], packagesCount: 1, totalGW: 5, totalNW: 4 };
  const model = core.buildModel(ci, pl, cfg, { GUINEA: 'GN' });
  assert.equal(model.items[0].netWeight, 4);
  assert.ok(model.warnings.some(w => w.includes('matched to packing-list row 1 by position')));
});
