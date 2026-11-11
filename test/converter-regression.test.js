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

function loadAsbCore() {
  const html = fs.readFileSync(require.resolve('../asb-converter.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const source = scripts.map(x => x[1]).find(x => x.includes('ASB International converter core'));
  assert.ok(source, 'ASB core script exists');
  const context = {};
  vm.runInNewContext(source, context);
  return context.FBCORE;
}

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
