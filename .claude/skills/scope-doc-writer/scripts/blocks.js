const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri" />';
const BORD = '<w:top w:val="single" w:color="7F7F7F" w:themeColor="accent6" w:themeTint="80" w:sz="4" /><w:left w:val="single" w:color="7F7F7F" w:themeColor="accent6" w:themeTint="80" w:sz="4" /><w:bottom w:val="single" w:color="7F7F7F" w:themeColor="accent6" w:themeTint="80" w:sz="4" /><w:right w:val="single" w:color="7F7F7F" w:themeColor="accent6" w:themeTint="80" w:sz="4" />';

const run = (text, rpr) => `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (text, ppr, rpr) => `<w:p><w:pPr>${ppr}</w:pPr>${text === '' ? '' : run(text, rpr)}</w:p>`;
const lines = (text, ppr, rpr) => String(text).split('\n').map((l) => para(l, ppr, rpr)).join('');

const heading = (level, text, pageBreak) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}" />${pageBreak ? '<w:pageBreakBefore />' : ''}</w:pPr>${run(text, FONT)}</w:p>`;

const bodyP = (text) => lines(text, '<w:spacing w:after="80" w:line="259" w:lineRule="auto" />', '<w:sz w:val="21" /><w:szCs w:val="21" /><w:lang w:val="en-US" />');
const bullets = (items) =>
  items
    .map((t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="2" /></w:numPr><w:spacing w:after="60" w:line="259" w:lineRule="auto" /></w:pPr>${run(t, '<w:sz w:val="21" /><w:szCs w:val="21" /><w:lang w:val="en-US" />')}</w:p>`)
    .join('');

function cell(width, text, head) {
  const tcPr = head
    ? `<w:tcW w:w="${width}" w:type="dxa" /><w:tcBorders>${BORD}</w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="153D63" /><w:tcMar><w:top w:w="70" w:type="dxa" /><w:left w:w="90" w:type="dxa" /><w:bottom w:w="70" w:type="dxa" /><w:right w:w="90" w:type="dxa" /></w:tcMar><w:vAlign w:val="center" />`
    : `<w:tcW w:w="${width}" w:type="dxa" /><w:tcBorders>${BORD}</w:tcBorders><w:tcMar><w:top w:w="60" w:type="dxa" /><w:left w:w="90" w:type="dxa" /><w:bottom w:w="60" w:type="dxa" /><w:right w:w="90" w:type="dxa" /></w:tcMar><w:vAlign w:val="top" />`;
  const ppr = head ? '<w:spacing w:after="0" /><w:jc w:val="left" />' : '<w:spacing w:after="0" w:line="245" />';
  const rpr = head ? `<w:b /><w:bCs /><w:color w:val="FFFFFF" /><w:sz w:val="20" /><w:szCs w:val="20" />${FONT}` : `<w:sz w:val="19" /><w:szCs w:val="19" />${FONT}`;
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${lines(text === null || text === undefined ? '' : text, ppr, rpr)}</w:tc>`;
}

function table(b) {
  const n = b.cols.length;
  let widths = b.widths && b.widths.length === n ? b.widths.slice() : Array(n).fill(Math.floor(9600 / n));
  const sum = widths.reduce((a, c) => a + c, 0);
  if (sum !== 9638) {
    const k = 9638 / sum;
    widths = widths.map((w) => Math.round(w * k));
    widths[n - 1] += 9638 - widths.reduce((a, c) => a + c, 0);
  }
  const grid = widths.map((w) => `<w:gridCol w:w="${w}" />`).join('');
  const head = `<w:tr><w:trPr><w:cantSplit /><w:tblHeader /></w:trPr>${b.cols.map((c, i) => cell(widths[i], c, true)).join('')}</w:tr>`;
  const rows = b.rows
    .map((r) => {
      const cells = r.slice(0, n);
      while (cells.length < n) cells.push('');
      return `<w:tr><w:trPr><w:cantSplit w:val="false" /></w:trPr>${cells.map((c, i) => cell(widths[i], c, false)).join('')}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa" /><w:tblBorders><w:top w:val="single" w:color="auto" w:sz="4" /><w:left w:val="single" w:color="auto" w:sz="4" /><w:bottom w:val="single" w:color="auto" w:sz="4" /><w:right w:val="single" w:color="auto" w:sz="4" /><w:insideH w:val="single" w:color="auto" w:sz="4" /><w:insideV w:val="single" w:color="auto" w:sz="4" /></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${rows}</w:tbl><w:p><w:pPr><w:spacing w:after="120" /></w:pPr></w:p>`;
}

function callout(b) {
  const inner =
    (b.title ? para(b.title, '<w:spacing w:after="40" />', `<w:b /><w:bCs /><w:color w:val="153D63" /><w:sz w:val="21" /><w:szCs w:val="21" />${FONT}`) : '') +
    lines(b.text, '<w:spacing w:after="40" w:line="250" w:lineRule="auto" />', '<w:sz w:val="20" /><w:szCs w:val="20" /><w:lang w:val="en-US" />');
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa" /><w:tblBorders><w:top w:val="single" w:color="auto" w:sz="4" /><w:left w:val="single" w:color="auto" w:sz="4" /><w:bottom w:val="single" w:color="auto" w:sz="4" /><w:right w:val="single" w:color="auto" w:sz="4" /><w:insideH w:val="single" w:color="auto" w:sz="4" /><w:insideV w:val="single" w:color="auto" w:sz="4" /></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="9638" /></w:tblGrid><w:tr><w:trPr><w:cantSplit /></w:trPr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa" /><w:tcBorders><w:top w:val="single" w:color="EEF3F8" w:sz="1" /><w:left w:val="single" w:color="153D63" w:sz="24" /><w:bottom w:val="single" w:color="EEF3F8" w:sz="1" /><w:right w:val="single" w:color="EEF3F8" w:sz="1" /></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="EEF3F8" /><w:tcMar><w:top w:w="90" w:type="dxa" /><w:left w:w="160" w:type="dxa" /><w:bottom w:w="90" w:type="dxa" /><w:right w:w="140" w:type="dxa" /></w:tcMar></w:tcPr>${inner}</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="120" /></w:pPr></w:p>`;
}


const blockXml = (b) => {
  if (b.type === 'h2') return heading(2, b.text);
  if (b.type === 'h3') return heading(3, b.text);
  if (b.type === 'p') return bodyP(b.text);
  if (b.type === 'bullets') return bullets(b.items);
  if (b.type === 'table') return table(b);
  if (b.type === 'callout') return callout(b);
  throw new Error('unknown block ' + b.type);
};
const chapterXml = (ch) => heading(1, ch.h1, true) + ch.blocks.map(blockXml).join('');
module.exports = { chapterXml, blockXml, heading, para, esc, FONT };
