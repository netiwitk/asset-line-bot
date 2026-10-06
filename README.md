# บอท LINE ระบบทรัพย์สิน (asset-line-bot)

บอท LINE ที่ต่อกับ [asset-laravel](https://github.com/netiwitk/asset-laravel) รันบน Cloudflare Workers

- พิมพ์รหัสทรัพย์สิน เช่น `AV-67-0037` แล้วได้การ์ดที่บอกสถานะ หน่วยงาน มูลค่าตามบัญชี และผู้ยืม พร้อมปุ่มเปิดในแอปสแกน ([asset-scanner](https://github.com/netiwitk/asset-scanner))
- พิมพ์ "เกินกำหนด" แล้วได้รายการของที่ยังไม่คืน เรียงจากที่เกินนานที่สุด แตะรายการไหนก็เปิดการ์ดของชิ้นนั้น
- แอดเพื่อนแล้วได้ข้อความแนะนำวิธีใช้ พร้อมปุ่มลัด

## ทำงานอย่างไร

```
LINE ──webhook──▶ Worker (ตรวจลายเซ็น, ตอบ 200 ทันที)
                     └─ งานเบื้องหลัง ─▶ แสดง "กำลังพิมพ์" ─▶ ถาม API ของ asset-laravel ─▶ ตอบกลับ (reply)
```

- ตรวจลายเซ็น `x-line-signature` ก่อนอ่านข้อความทุกครั้ง ข้อความที่ไม่ได้มาจาก LINE จะได้ 401
- ใช้แต่การตอบกลับ (reply) ซึ่งฟรี ไม่ใช้โควตา 300 ข้อความต่อเดือนของแพ็กเกจฟรี
- เซิร์ฟเวอร์ demo บน Render หลับเมื่อไม่มีคนใช้ และตื่นช้ากว่าที่ token ตอบกลับจะหมดอายุ ถ้ารอเกิน 15 วินาที บอทจะตอบว่าระบบกำลังตื่น พร้อมปุ่ม "ลองใหม่" ที่ส่งข้อความเดิมซ้ำ
- บอท demo ใช้สิทธิ์เจ้าหน้าที่พัสดุจึงเห็นทุกหน่วยงาน ถ้าจะใช้งานจริงต้องผูกบัญชี LINE ของแต่ละคนกับบัญชีในระบบ

## ไฟล์

- `src/index.js` รับ webhook และจัดการทีละเหตุการณ์
- `src/line.js` ตรวจลายเซ็น และเรียก API ของ LINE
- `src/api.js` เรียก API ของ asset-laravel (เก็บ token ไว้ใช้ซ้ำ ขอใหม่เมื่อเซิร์ฟเวอร์ reset)
- `src/bot.js` แปลข้อความที่พิมพ์มา และสร้างข้อความตอบ (ไม่ต่อเน็ต ทดสอบได้ทั้งหมด)

## ทดสอบ

```bash
npm install
npm test                       # เทสต์ทั้งหมด ไม่ต้องต่อเน็ต
node tool/e2e.mjs              # รันใน Workers runtime จริง กับ asset-laravel ในเครื่อง (APP_DEMO=true, seed ใหม่)
node tool/validate.mjs         # ให้ LINE ตรวจรูปแบบข้อความทุกแบบ (อ่าน token จาก .dev.vars)
```

## ติดตั้ง

1. สร้าง LINE Official Account เปิด Messaging API แล้วออก Channel access token (long-lived)
2. ใส่ความลับใน Cloudflare (พิมพ์ค่าในช่องที่คำสั่งถาม ไม่ต้องใส่ไว้ในไฟล์)
   ```bash
   npx wrangler secret put LINE_CHANNEL_SECRET
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   npx wrangler deploy
   ```
3. ใน LINE Developers ตั้ง Webhook URL เป็น `https://<worker>.workers.dev/webhook` กด Verify แล้วเปิด Use webhook
4. ใน LINE Official Account Manager ปิดข้อความตอบกลับอัตโนมัติและข้อความต้อนรับ ไม่อย่างนั้นทุกข้อความจะได้คำตอบซ้ำสองชุด
