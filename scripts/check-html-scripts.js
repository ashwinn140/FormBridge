'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'anu-worles-converter.html', 'anu-worles-tech-converter.html',
  'asb-converter.html', 'cass-reconciliation.html', 'sandvik-converter.html',
  'seco-converter.html', 'vvdn-converter.html'
];
let checked = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const scripts = html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi);
  let index = 0;
  for (const match of scripts) {
    const attrs = match[1] || '';
    if (/\\bsrc\\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\\btype\\s*=\\s*[\"']([^\"']+)[\"']/i) || [])[1];
    if (type && !/^(?:text|application)\\/(?:java|ecma)script$|^module$/i.test(type.trim())) continue;
    const source = match[2].trim();
    if (!source) continue;
    index += 1;
    new vm.Script(source, { filename: page + ':inline-script-' + index });
    checked += 1;
  }
}
process.stdout.write('Syntax-checked ' + checked + ' inline JavaScript blocks across ' + pages.length + ' HTML pages.\\n');
