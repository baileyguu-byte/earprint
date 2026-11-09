// Front page: the hearing-and-age chart and its table. Uses the same numbers as the lab.
import { medianShift, ISO_F } from './hearing.js';
import { renderCurveChart, sgn, fText } from './curves.js';

const AGES = [30, 45, 60, 75];
const data = AGES.map((a) => medianShift(a, 'any'));

function drawChart() {
  const box = document.getElementById('ageChartHome');
  if (!box) return;
  renderCurveChart(box, {
    height: 280, fMin: 125, fMax: 8000,
    xTicks: box.clientWidth < 520
      ? [[125, '125 Hz'], [500, '500'], [2000, '2k'], [8000, '8k']]
      : [[125, '125 Hz'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [4000, '4k'], [8000, '8 kHz']],
    yMin: -60, yMax: 0, yTicks: [0, -10, -20, -30, -40, -50, -60],
    series: AGES.map((a, i) => ({ label: 'Age ' + a, freqs: ISO_F, values: data[i].map((v) => -v), cls: 'age' + (i + 1), end: String(a) })),
    snap: ISO_F,
    tipRows: (k) => AGES.map((a, i) => ['age' + (i + 1), 'Age ' + a, sgn(-data[i][k], 0) + ' dB']).reverse(),
    aria: 'Typical change in hearing compared with age 18, at ages 30, 45, 60 and 75, from 125 Hz to 8 kHz. The change is small in the bass and mids and grows steeply in the treble with age.'
  });
}
function fillTable() {
  const t = document.getElementById('ageTable');
  if (!t) return;
  const head = '<thead><tr><th scope="col">Age</th>' + ISO_F.map((f) => '<th scope="col">' + fText(f) + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + AGES.map((a, i) => '<tr><th scope="row">' + a + '</th>' + data[i].map((v) => '<td>' + sgn(-v, 0) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  t.innerHTML = '<caption>Change in dB compared with age 18 (median, men and women averaged)</caption>' + head + body;
}

fillTable();
drawChart();
let w = 0;
new ResizeObserver(() => {
  const box = document.getElementById('ageChartHome');
  if (box && box.clientWidth !== w) { w = box.clientWidth; drawChart(); }
}).observe(document.getElementById('ageChartHome'));
