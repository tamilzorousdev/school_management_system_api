#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paraText(p) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let m;
  while ((m = re.exec(p))) out.push(m[1] !== undefined ? unesc(m[1]) : ' ');
  return out.join('');
}

function splitParas(inner) {
  const res = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(inner))) res.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  return res;
}

function scan(xml) {
  const body = [];
  const tables = [];
  const items = [];
  const tblRe = /<w:tbl[ >][\s\S]*?<\/w:tbl>/g;
  let tm;
  const tblRanges = [];
  while ((tm = tblRe.exec(xml))) tblRanges.push([tm.index, tm.index + tm[0].length]);
  const inTable = (pos) => tblRanges.some(([a, b]) => pos >= a && pos < b);
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pm;
  let heading = '';
  while ((pm = paraRe.exec(xml))) {
    if (inTable(pm.index)) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(pm[0]);
    const text = paraText(pm[0]);
    const isHeading = style && /^Heading/.test(style[1]);
    if (isHeading) heading = text;
    items.push({ kind: 'para', start: pm.index, end: pm.index + pm[0].length, text, heading, isHeading: !!isHeading });
  }
  tblRanges.forEach(([a, b], ti) => {
    const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
    const seg = xml.slice(a, b);
    let rm;
    let hd = '';
    for (let i = items.length - 1; i >= 0; i--) if (items[i].isHeading && items[i].start < a) { hd = items[i].text; break; }
    while ((rm = rowRe.exec(seg))) {
      const rowXml = rm[0];
      const cells = [];
      const cellRe = /<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g;
      let cm;
      while ((cm = cellRe.exec(rowXml))) {
        const paras = splitParas(cm[0]).map((p) => paraText(p.xml));
        cells.push({ start: cm.index, end: cm.index + cm[0].length, text: paras.join('\n') });
      }
      items.push({ kind: 'row', table: ti, start: a + rm.index, end: a + rm.index + rowXml.length, cells, heading: hd });
    }
  });
  items.sort((x, y) => x.start - y.start);
  return items;
}

function matchHeading(it, section) {
  return !section || (it.heading || '').startsWith(section);
}

function findRow(items, op, keyName = 'row') {
  const key = op[keyName];
  const startsKey = op[keyName + 'Starts'];
  let occ = op.occ || 1;
  for (const it of items) {
    if (it.kind !== 'row' || !it.cells.length) continue;
    if (!matchHeading(it, op.section)) continue;
    const t = it.cells[0].text.trim();
    const hit = key !== undefined ? t === key : startsKey !== undefined ? t.startsWith(startsKey) : false;
    if (hit && --occ === 0) return it;
  }
  throw new Error('row not found: ' + JSON.stringify(op).slice(0, 200));
}

function findPara(items, op, keyName = 'startsWith') {
  let occ = op.occ || 1;
  const key = op[keyName];
  for (const it of items) {
    if (it.kind !== 'para' || it.isHeading) continue;
    if (!matchHeading(it, op.section)) continue;
    if (it.text.trim().startsWith(key) && --occ === 0) return it;
  }
  throw new Error('paragraph not found: ' + JSON.stringify(op).slice(0, 200));
}

function firstRPr(xml) {
  const m = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(xml);
  return m ? m[1] : '';
}

function buildParas(templPara, text) {
  const pPrM = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(templPara);
  const pPr = pPrM ? pPrM[0] : '';
  const rPr = firstRPr(templPara);
  return String(text)
    .split('\n')
    .map((line) => `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
    .join('');
}

function setCellXml(cellXml, text, fallbackRPr) {
  const paras = splitParas(cellXml);
  const t1 = paras.length ? paras[0].xml : '<w:p></w:p>';
  const t2 = paras.length > 1 ? paras[1].xml : t1;
  const fmt = (t) => {
    const pPrM = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(t);
    return { pPr: pPrM ? pPrM[0] : '', rPr: firstRPr(t) || fallbackRPr || '' };
  };
  const f1 = fmt(t1);
  const f2 = fmt(t2);
  const open = /^<w:tc[^>]*>[\s\S]*?<\/w:tcPr>/.exec(cellXml);
  const head = open ? open[0] : cellXml.slice(0, cellXml.indexOf('>') + 1);
  const ps = String(text)
    .split('\n')
    .map((line, i) => {
      const f = i === 0 ? f1 : f2;
      return `<w:p>${f.pPr}<w:r>${f.rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;
    })
    .join('');
  return head + ps + '</w:tc>';
}

function rowCells(rowXml) {
  const cells = [];
  const cellRe = /<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g;
  let m;
  while ((m = cellRe.exec(rowXml))) cells.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  return cells;
}

function rewriteRow(rowXml, texts) {
  const cells = rowCells(rowXml);
  const fallback = firstRPr(rowXml);
  let out = '';
  let pos = 0;
  cells.forEach((c, i) => {
    out += rowXml.slice(pos, c.start);
    const t = texts[i];
    out += t === null || t === undefined ? c.xml : setCellXml(c.xml, t, fallback);
    pos = c.end;
  });
  out += rowXml.slice(pos);
  return out;
}

function freshParaIds(xml) {
  return xml.replace(/ w14:paraId="[0-9A-F]+"/g, '').replace(/ wp14:textId="[0-9A-F]+"/g, '');
}

function applyOp(xml, op) {
  const items = scan(xml);
  const splice = (a, b, s) => xml.slice(0, a) + s + xml.slice(b);
  switch (op.op) {
    case 'setCell': {
      const row = findRow(items, op);
      const cells = rowCells(xml.slice(row.start, row.end));
      const c = cells[op.col];
      if (!c) throw new Error('no column ' + op.col + ' in row ' + op.row);
      const fallback = firstRPr(xml.slice(row.start, row.end));
      const newCell = setCellXml(c.xml, op.text, fallback);
      return splice(row.start + c.start, row.start + c.end, newCell);
    }
    case 'replaceInCell': {
      const row = findRow(items, op);
      const cells = rowCells(xml.slice(row.start, row.end));
      const c = cells[op.col];
      if (!c) throw new Error('no column ' + op.col + ' in row ' + op.row);
      const cur = row.cells[op.col].text;
      if (!cur.includes(op.find)) throw new Error('text not in cell: ' + op.find.slice(0, 80) + ' in ' + (op.row || op.rowStarts));
      const fallback = firstRPr(xml.slice(row.start, row.end));
      const newCell = setCellXml(c.xml, cur.replace(op.find, () => op.repl), fallback);
      return splice(row.start + c.start, row.start + c.end, newCell);
    }
    case 'setRow': {
      const row = findRow(items, op);
      return splice(row.start, row.end, rewriteRow(xml.slice(row.start, row.end), op.cells));
    }
    case 'addRow': {
      const row = findRow(items, op, 'after');
      const tmpl = freshParaIds(xml.slice(row.start, row.end));
      const nr = rewriteRow(tmpl.replace(/ w14:paraId="[0-9A-F]+"/g, ''), op.cells);
      return splice(row.end, row.end, nr);
    }
    case 'deleteRow': {
      const row = findRow(items, op);
      return splice(row.start, row.end, '');
    }
    case 'setPara': {
      const p = findPara(items, op);
      const t = xml.slice(p.start, p.end);
      return splice(p.start, p.end, buildParas(t, op.text));
    }
    case 'replaceInPara': {
      const p = findPara(items, op);
      if (!p.text.includes(op.find)) throw new Error('text not in paragraph: ' + op.find.slice(0, 80));
      const t = xml.slice(p.start, p.end);
      return splice(p.start, p.end, buildParas(t, p.text.replace(op.find, () => op.repl)));
    }
    case 'addPara': {
      const p = findPara(items, op, 'after');
      const t = xml.slice(p.start, p.end);
      return splice(p.end, p.end, buildParas(t, op.text));
    }
    case 'setHeading': {
      let occ = op.occ || 1;
      const h = items.find((it) => it.kind === 'para' && it.isHeading && it.text.trim().startsWith(op.startsWith) && --occ === 0);
      if (!h) throw new Error('heading not found: ' + op.startsWith);
      const t = xml.slice(h.start, h.end);
      return splice(h.start, h.end, buildParas(t, op.text));
    }
    case 'insertHeadingBefore': {
      const p = findPara(items, { startsWith: op.before, occ: op.occ });
      const tmpl = items.find((it) => it.kind === 'para' && it.isHeading && it.text.trim().startsWith(op.like));
      if (!tmpl) throw new Error('template heading not found: ' + op.like);
      const th = xml.slice(tmpl.start, tmpl.end);
      return splice(p.start, p.start, buildParas(th, op.text));
    }
    case 'renumber': {
      const rows = items.filter((it) => it.kind === 'row' && it.heading.startsWith(op.section) && it.cells.length && it.cells[0].text.trim() !== '#');
      const map = [];
      let out = xml;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const cells = rowCells(out.slice(r.start, r.end));
        const fb = firstRPr(out.slice(r.start, r.end));
        map.unshift(r.cells[0].text.trim() + '->' + (i + 1));
        const nc = setCellXml(cells[0].xml, String(i + 1), fb);
        out = out.slice(0, r.start + cells[0].start) + nc + out.slice(r.start + cells[0].end);
      }
      console.error('renumber map: ' + map.join(' '));
      return out;
    }
    case 'deletePara': {
      const p = findPara(items, op);
      return splice(p.start, p.end, '');
    }
    default:
      throw new Error('unknown op ' + op.op);
  }
}

function main() {
  const [, , cmd, dir, arg, arg2] = process.argv;
  const docPath = path.join(dir, 'word', 'document.xml');
  let xml = fs.readFileSync(docPath, 'utf8');
  if (cmd === 'find') {
    const items = scan(xml);
    for (const it of items) {
      const t = it.kind === 'row' ? it.cells.map((c) => c.text.replace(/\n/g, ' / ')).join(' | ') : it.text;
      if (t.includes(arg)) console.log(it.kind, '[' + it.heading.slice(0, 22) + ']', t.slice(0, 220));
    }
  } else if (cmd === 'apply') {
    const ops = JSON.parse(fs.readFileSync(arg, 'utf8'));
    const failed = [];
    let ok = 0;
    for (const [i, op] of ops.entries()) {
      try {
        xml = applyOp(xml, op);
        ok++;
      } catch (e) {
        failed.push({ i, error: e.message });
      }
    }
    if (!arg2 || arg2 !== '--dry') fs.writeFileSync(docPath, xml);
    console.log(JSON.stringify({ applied: ok, failed }, null, 1));
  } else if (cmd === 'rows') {
    const items = scan(xml);
    for (const it of items) if (it.kind === 'row' && it.heading.startsWith(arg)) console.log(it.cells.map((c) => c.text.replace(/\n/g, ' / ')).join(' | '));
  } else {
    console.log('usage: dp.js find|rows|apply <dir> <arg>');
  }
}
main();
