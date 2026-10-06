// Asks LINE whether every kind of message this bot sends is valid, without sending anything to anyone.
// It reads LINE_CHANNEL_ACCESS_TOKEN from .dev.vars (gitignored), so the token never goes on the command line.
//
// usage:  node tool/validate.mjs
import { readFileSync } from 'node:fs';
import { assetCard, help, notFound, overdueList, unavailable } from '../src/bot.js';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
if (!vars.LINE_CHANNEL_ACCESS_TOKEN) throw new Error('Put LINE_CHANNEL_ACCESS_TOKEN=... in .dev.vars first');

const status = (value, label, tone) => ({ value, label, tone });
const fullAsset = {
  tag: 'AV-67-0034',
  name: 'โปรเจกเตอร์ Epson',
  category: 'โสตทัศนูปกรณ์',
  department: 'ฝ่ายทรัพยากรบุคคล',
  location: 'อาคาร A ชั้น 2',
  custodian: 'สมชาย ใจดี',
  condition: status('usable', 'ใช้งานได้', 'success'),
  availability: status('on_loan', 'ถูกยืม', 'info'),
  book_value: '12345.60',
  loan: { status: status('handed_over', 'ส่งมอบแล้ว', 'primary'), borrower: 'พนักงานทดลอง', due_on: '1 ต.ค. 2569', is_overdue: true, purpose: 'ถ่ายวิดีโอ' },
  actions: [],
};
const loans = Array.from({ length: 12 }, (_, i) => ({ tag: `AV-67-00${10 + i}`, name: 'โปรเจกเตอร์', borrower: 'สมชาย', due_on: '1 ต.ค. 2569', days_overdue: 12 - i }));

const samples = {
  help: help(),
  'not found': notFound('XX-00-0000'),
  unavailable: unavailable('AV-67-0037'),
  'asset card (everything filled in)': assetCard(fullAsset, 'https://netiwitk.github.io/asset-scanner/'),
  'asset card (no loan, no extras)': assetCard({ ...fullAsset, loan: null, location: null, custodian: null, book_value: null }, 'https://netiwitk.github.io/asset-scanner/'),
  'overdue list (12, capped)': overdueList(loans),
  'overdue list (empty)': overdueList([]),
};

let failed = false;
for (const [name, message] of Object.entries(samples)) {
  const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vars.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ messages: [message] }),
  });
  failed ||= !res.ok;
  console.log(`${res.ok ? 'ok  ' : 'FAIL'}  ${name}${res.ok ? '' : `: ${res.status} ${await res.text()}`}`);
}
process.exit(failed ? 1 : 0);
