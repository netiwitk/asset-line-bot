import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OVERDUE_LIMIT, assetCard, baht, help, intentOf, overdueList, unavailable } from '../src/bot.js';

/** The JSON shape of GET /api/assets/{tag} from asset-laravel's ScannedAssetResource. */
const asset = {
  tag: 'AV-67-0034',
  name: 'โปรเจกเตอร์ Epson',
  category: 'โสตทัศนูปกรณ์',
  department: 'ฝ่ายทรัพยากรบุคคล',
  location: 'อาคาร A ชั้น 2',
  custodian: null,
  condition: { value: 'usable', label: 'ใช้งานได้', tone: 'success' },
  availability: { value: 'on_loan', label: 'ถูกยืม', tone: 'info' },
  book_value: '12345.60',
  loan: {
    status: { value: 'handed_over', label: 'ส่งมอบแล้ว', tone: 'primary' },
    borrower: 'พนักงานทดลอง',
    due_on: '1 ต.ค. 2569',
    is_overdue: true,
    purpose: null,
  },
  actions: [],
};

const texts = (node) => JSON.stringify(node).match(/"text":"[^"]*"/g).map((t) => t.slice(8, -1));

test('reads keywords, tags and scanner links; anything else gets help', () => {
  assert.deepEqual(intentOf('  av-67-0037 '), { kind: 'asset', tag: 'AV-67-0037' });
  assert.deepEqual(intentOf('https://netiwitk.github.io/asset-scanner/#/a/COM-64-0002'), { kind: 'asset', tag: 'COM-64-0002' });
  assert.deepEqual(intentOf('มีอะไรเกินกำหนดบ้าง'), { kind: 'overdue' });
  assert.deepEqual(intentOf('Overdue'), { kind: 'overdue' });
  assert.deepEqual(intentOf('สวัสดีครับ'), { kind: 'help' });
  assert.deepEqual(intentOf('AV 67'), { kind: 'help' });
  assert.deepEqual(intentOf(''), { kind: 'help' });
});

test('the asset card shows its facts, the late loan, and opens the scanner app on that tag', () => {
  const card = assetCard(asset, 'https://scan.example/');
  const shown = texts(card);

  assert.ok(shown.includes('โปรเจกเตอร์ Epson'));
  assert.ok(shown.includes('฿12,345.60'));
  assert.ok(shown.includes('พนักงานทดลอง'));
  assert.ok(shown.some((t) => t.includes('เกินกำหนด')));
  assert.ok(!shown.includes('ผู้ดูแล'), 'no custodian row when there is none');
  assert.equal(card.contents.footer.contents[0].action.uri, 'https://scan.example/#/a/AV-67-0034');
  assert.equal(card.altText, 'โปรเจกเตอร์ Epson (AV-67-0034) · ใช้งานได้ · ถูกยืม');
});

test('row labels wrap instead of being cut off', () => {
  const rows = assetCard(asset, 'https://scan.example/').contents.body.contents.filter((n) => n.layout === 'horizontal' && n.spacing === 'md');
  const book = rows.find((r) => r.contents[0].text === 'มูลค่าตามบัญชี');

  assert.ok(book, 'book value row');
  for (const r of rows) assert.equal(r.contents[0].wrap, true, r.contents[0].text);
});

test('an asset that is not out on loan has no loan section', () => {
  const card = assetCard({ ...asset, loan: null }, 'https://scan.example/');

  assert.ok(!texts(card).includes('การยืม'));
});

test('the overdue list stops at the limit and says how many more', () => {
  const loans = Array.from({ length: OVERDUE_LIMIT + 3 }, (_, i) => ({
    tag: `T-${i}`,
    name: `Item ${i}`,
    borrower: 'B',
    due_on: '1 ต.ค. 2569',
    days_overdue: 20 - i,
  }));
  const shown = texts(overdueList(loans));

  assert.ok(shown.includes(`ของเกินกำหนดคืน ${OVERDUE_LIMIT + 3} รายการ`));
  assert.ok(shown.includes(`T-${OVERDUE_LIMIT - 1}  `));
  assert.ok(!shown.includes(`T-${OVERDUE_LIMIT}  `));
  assert.ok(shown.includes('และอีก 3 รายการ'));
  assert.equal(overdueList([]).text, 'ตอนนี้ไม่มีของเกินกำหนดคืน');
});

test('quick reply buttons fit LINE limits and "ลองใหม่" resends the same text', () => {
  for (const item of help().quickReply.items) assert.ok(item.action.label.length <= 20);
  assert.equal(unavailable('AV-67-0037').quickReply.items[0].action.text, 'AV-67-0037');
});

test('baht groups thousands', () => {
  assert.equal(baht('1234567.50'), '฿1,234,567.50');
  assert.equal(baht('1.00'), '฿1.00');
});
