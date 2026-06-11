const fs = require('fs');

const files = [
  'denetim_admin/index.html',
  'denetim_admin/script.js',
];

const replacements = [
  ['\u00c3\u0192\u00c2\u00bc', '\u00fc'],
  ['\u00c3\u0192\u00c2\u0153', '\u00dc'],
  ['\u00c3\u0192\u00c2\u00b6', '\u00f6'],
  ['\u00c3\u0192\u00e2\u20ac\u201c', '\u00d6'],
  ['\u00c3\u0192\u00c2\u00a7', '\u00e7'],
  ['\u00c3\u0192\u00e2\u20ac\u00a1', '\u00c7'],
  ['\u00c3\u201e\u00c2\u00b1', '\u0131'],
  ['\u00c3\u201e\u00c2\u00b0', '\u0130'],
  ['\u00c3\u201e\u00c2\u0178', '\u011f'],
  ['\u00c3\u201e\u00c2\u017d', '\u011e'],
  ['\u00c3\u2026\u00c2\u0178', '\u015f'],
  ['\u00c3\u2026\u00c2\u017d', '\u015e'],

  ['\u00c3\u00bc', '\u00fc'],
  ['\u00c3\u0153', '\u00dc'],
  ['\u00c3\u00b6', '\u00f6'],
  ['\u00c3\u2013', '\u00d6'],
  ['\u00c3\u00a7', '\u00e7'],
  ['\u00c3\u2021', '\u00c7'],
  ['\u00c4\u00b1', '\u0131'],
  ['\u00c4\u00b0', '\u0130'],
  ['\u00c4\u0178', '\u011f'],
  ['\u00c4\u017e', '\u011e'],
  ['\u00c5\u0178', '\u015f'],
  ['\u00c5\u017e', '\u015e'],

  ['\u00e2\u20ac\u00a2', '\u2022'],
  ['\u00e2\u20ac\u201c', '-'],
  ['\u00e2\u20ac\u201d', '-'],
  ['\u00e2\u20ac\u02dc', "'"],
  ['\u00e2\u20ac\u2122', "'"],
  ['\u00e2\u20ac\u0153', '"'],
  ['\u00e2\u20ac\u009d', '"'],
  ['\u00e2\u20ac\u00a6', '...'],
  ['\u00e2\u201d\u20ac', '-'],
  ['\u00c2 ', ' '],
  ['\u00c2', ''],
];

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  let previous;
  do {
    previous = text;
    for (const [bad, good] of replacements) {
      text = text.split(bad).join(good);
    }
  } while (text !== previous);
  fs.writeFileSync(file, text, 'utf8');
  console.log(`fixed ${file}`);
}
