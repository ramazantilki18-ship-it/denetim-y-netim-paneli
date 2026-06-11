const fs = require('fs');

const js = fs.readFileSync('denetim_admin/script.js', 'utf8');
const html = fs.readFileSync('denetim_admin/index.html', 'utf8');
const repairIndex = js.indexOf('Admin module repair overrides');
const badChars = ['\u00c3', '\u00c4', '\u00c5', '\u00e2', '\u00c2', '\ufffd']
  .reduce((count, ch) => count + (js + html).split(ch).length - 1, 0);

console.log(JSON.stringify({
  scriptVersion: (html.match(/script\.js\?v=([^"]+)/) || [])[1] || null,
  cssVersion: (html.match(/style\.css\?v=([^"]+)/) || [])[1] || null,
  repairBlock: repairIndex >= 0,
  peopleOverrideLast: js.lastIndexOf('function renderPeople') > repairIndex,
  questionOverrideLast: js.lastIndexOf('function renderQuestionGroups') > repairIndex,
  linesOverrideLast: js.lastIndexOf('function renderLines') > repairIndex,
  badChars,
}, null, 2));
