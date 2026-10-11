// What a chat message means, and the LINE messages that answer it. No network here, so it is all testable.

const INK = '#0F172A';
const MUTED = '#64748B';
const BLUE = '#2563EB';
const LINE_COLOR = '#E2E8F0';

/** The asset system's badge colour names, as the scanner app draws them. */
const TONES = { success: '#15803D', warning: '#B45309', danger: '#DC2626', info: '#0E7490', primary: BLUE, gray: MUTED };

/** Tags from the demo server's seed data, the same after every reset. */
const SAMPLE_TAGS = ['AV-67-0037', 'AV-67-0034', 'COM-65-0010'];

const OVERDUE_WORDS = ['เกินกำหนด', 'ค้างคืน', 'overdue'];

const SUBSCRIBE = 'รับแจ้งเตือน';
const UNSUBSCRIBE = 'เลิกแจ้งเตือน';

/** How many overdue loans one card lists before "and N more". */
export const OVERDUE_LIMIT = 10;

/**
 * A word for the overdue list, a tag (or a scanner app link to one), or anything else, which gets the help text.
 * A tag is one word with a digit in it; the server decides whether it exists.
 * The alert commands come first: "รับแจ้งเตือนของเกินกำหนด" asks for the alert, not the list.
 */
export function intentOf(text) {
  const trimmed = (text ?? '').trim();
  if (trimmed.startsWith(SUBSCRIBE)) return { kind: 'subscribe' };
  if (trimmed.startsWith(UNSUBSCRIBE)) return { kind: 'unsubscribe' };
  if (OVERDUE_WORDS.some((word) => trimmed.toLowerCase().includes(word))) return { kind: 'overdue' };
  const link = trimmed.match(/#\/a\/([^/?#\s]+)$/);
  const word = link ? decodeURIComponent(link[1]) : trimmed;
  if (/^\S{2,40}$/.test(word) && /\d/.test(word)) return { kind: 'asset', tag: word.toUpperCase() };
  return { kind: 'help' };
}

export function help() {
  return withQuickReplies({
    type: 'text',
    text: [
      'บอทระบบทรัพย์สิน (demo)',
      '',
      '• พิมพ์รหัสทรัพย์สิน เช่น AV-67-0037 เพื่อดูสถานะและผู้ยืม',
      '• พิมพ์ "เกินกำหนด" เพื่อดูของที่ยังไม่คืน',
      '• พิมพ์ "รับแจ้งเตือน" เพื่อรับรายการของเกินกำหนดทุกเช้า 08:00',
      '',
      'บอท demo ใช้สิทธิ์เจ้าหน้าที่พัสดุ จึงเห็นทุกหน่วยงาน',
    ].join('\n'),
  });
}

export function notFound(tag) {
  return withQuickReplies({ type: 'text', text: `ไม่พบรหัส ${tag}\nลองตรวจตัวอักษรอีกครั้ง หรือกดรหัสตัวอย่างด้านล่าง` });
}

export function subscribed() {
  return {
    type: 'text',
    text: 'รับแจ้งเตือนแล้ว\nทุกเช้า 08:00 บอทจะส่งรายการของเกินกำหนดคืนให้ เป็นเวลา 3 วัน แล้วหยุดเอง\nพิมพ์ "เลิกแจ้งเตือน" ถ้าอยากหยุดก่อน',
    quickReply: { items: [messageButton(UNSUBSCRIBE, UNSUBSCRIBE)] },
  };
}

export function subscriptionsFull() {
  return withQuickReplies({
    type: 'text',
    text: 'ตอนนี้ที่รับแจ้งเตือนของ demo เต็มแล้ว\nลองใหม่อีกครั้งในอีกไม่กี่วัน',
  });
}

export function unsubscribed() {
  return {
    type: 'text',
    text: 'เลิกแจ้งเตือนแล้ว บอทจะไม่ส่งรายการตอนเช้าอีก',
    quickReply: { items: [messageButton(SUBSCRIBE, SUBSCRIBE)] },
  };
}

/** The free demo server sleeps when nobody uses it; the first message after that only wakes it. */
export function unavailable(retryText) {
  return {
    type: 'text',
    text: 'ตอนนี้เชื่อมต่อระบบทรัพย์สินไม่ได้\nถ้าไม่มีใครใช้มาสักพัก เซิร์ฟเวอร์ demo แบบฟรีจะหลับ และใช้เวลาตื่นราว 1 นาที\nรอสักครู่แล้วกด "ลองใหม่"',
    quickReply: { items: [messageButton('ลองใหม่', retryText)] },
  };
}

/** One asset as a card: name, statuses, where it is, who has it, and a button into the scanner app. */
export function assetCard(asset, appUrl) {
  const loan = asset.loan;
  const rows = [
    row('หมวดหมู่', asset.category),
    row('หน่วยงาน', asset.department),
    asset.location && row('ที่ตั้ง', asset.location),
    asset.custodian && row('ผู้ดูแล', asset.custodian),
    asset.book_value && row('มูลค่าตามบัญชี', baht(asset.book_value)),
  ];
  const loanRows = loan && [
    { type: 'separator', margin: 'lg', color: LINE_COLOR },
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'lg',
      contents: [
        { type: 'text', text: 'การยืม', size: 'sm', weight: 'bold', color: INK, flex: 0 },
        { type: 'text', size: 'sm', align: 'end', contents: dot(loan.status) },
      ],
    },
    row('ผู้ยืม', loan.borrower),
    loan.due_on &&
      row('กำหนดคืน', loan.due_on, loan.is_overdue ? [{ type: 'span', text: '  ● เกินกำหนด', color: TONES.danger }] : []),
    loan.purpose && row('ใช้ทำอะไร', loan.purpose),
  ];

  return {
    type: 'flex',
    altText: clip(`${asset.name} (${asset.tag}) · ${asset.condition.label} · ${asset.availability.label}`),
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: asset.tag, size: 'xs', color: MUTED },
          { type: 'text', text: asset.name, size: 'lg', weight: 'bold', color: INK, wrap: true },
          {
            type: 'text',
            size: 'sm',
            margin: 'md',
            contents: [...dot(asset.condition), { type: 'span', text: '    ' }, ...dot(asset.availability)],
          },
          { type: 'separator', margin: 'lg', color: LINE_COLOR },
          ...rows.filter(Boolean),
          ...(loanRows ?? []).filter(Boolean),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: BLUE,
            height: 'sm',
            action: { type: 'uri', label: 'เปิดในแอปสแกน', uri: `${appUrl}#/a/${encodeURIComponent(asset.tag)}` },
          },
        ],
      },
    },
  };
}

/** Late loans, oldest first. Tapping one sends its tag, which opens its card. */
export function overdueList(loans) {
  if (loans.length === 0) return withQuickReplies({ type: 'text', text: 'ตอนนี้ไม่มีของเกินกำหนดคืน' });
  const shown = loans.slice(0, OVERDUE_LIMIT);
  const more = loans.length - shown.length;

  return {
    type: 'flex',
    altText: `ของเกินกำหนดคืน ${loans.length} รายการ`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `ของเกินกำหนดคืน ${loans.length} รายการ`, size: 'md', weight: 'bold', color: INK },
          { type: 'text', text: 'แตะรายการเพื่อดูรายละเอียด', size: 'xs', color: MUTED, margin: 'xs' },
          ...shown.flatMap((loan) => [
            { type: 'separator', margin: 'md', color: LINE_COLOR },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'md',
              action: { type: 'message', label: loan.tag.slice(0, 20), text: loan.tag },
              contents: [
                {
                  type: 'text',
                  size: 'sm',
                  wrap: true,
                  contents: [
                    { type: 'span', text: `${loan.tag}  `, weight: 'bold', color: INK },
                    { type: 'span', text: loan.name, color: INK },
                  ],
                },
                {
                  type: 'text',
                  size: 'xs',
                  wrap: true,
                  contents: [
                    { type: 'span', text: `${loan.borrower} · ครบ ${loan.due_on} · `, color: MUTED },
                    { type: 'span', text: `เกิน ${loan.days_overdue} วัน`, color: TONES.danger },
                  ],
                },
              ],
            },
          ]),
          ...(more > 0 ? [{ type: 'text', text: `และอีก ${more} รายการ`, size: 'xs', color: MUTED, margin: 'md' }] : []),
        ],
      },
    },
  };
}

function row(label, value, extra = []) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'md',
    contents: [
      // LINE cuts a label that does not fit with "…"; on a phone "มูลค่าตามบัญชี" did not fit at flex 2.
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 3, wrap: true },
      { type: 'text', size: 'sm', color: INK, flex: 5, wrap: true, contents: [{ type: 'span', text: value }, ...extra] },
    ],
  };
}

/** A status as a coloured dot and its label, like the scanner app. */
function dot(status) {
  return [
    { type: 'span', text: '● ', color: TONES[status.tone] ?? MUTED },
    { type: 'span', text: status.label, color: INK },
  ];
}

function withQuickReplies(message) {
  return { ...message, quickReply: { items: [...SAMPLE_TAGS, 'เกินกำหนด', SUBSCRIBE].map((text) => messageButton(text, text)) } };
}

function messageButton(label, text) {
  return { type: 'action', action: { type: 'message', label: label.slice(0, 20), text } };
}

/** "12345.60" → "฿12,345.60" */
export function baht(amount) {
  const [whole, fraction] = amount.split('.');
  return `฿${whole.replace(/\B(?=(\d{3})+$)/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

function clip(text) {
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}
