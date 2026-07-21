# HayaKarima Backend v2

نسخة Backend مجانية تعمل على Cloudflare Workers مع قاعدة بيانات D1، ومتوافقة مع صيغة المزامنة القديمة في تطبيق أندرويد.

## الواجهات

- `GET /ping`
- `GET /?action=ping`
- `GET /?action=get_events`
- `POST /` مع `action: sync_events`
- `GET /api/events`
- `POST /api/events`
- `PUT /api/events/:id`
- `DELETE /api/events/:id`
- `POST /api/sync`

## النشر من الهاتف

1. ارفع جميع الملفات إلى مستودع GitHub.
2. افتح Cloudflare وأنشئ حسابًا مجانيًا.
3. افتح **Workers & Pages** ثم **Create application** ثم **Import a repository**.
4. اختر مستودع `HayaKarima-Backend`.
5. أنشئ قاعدة D1 باسم `hayakarima-db`.
6. انسخ `database_id` وضعه في `wrangler.jsonc` بدل `REPLACE_WITH_D1_DATABASE_ID`.
7. تأكد أن اسم ربط قاعدة البيانات هو `DB` ثم نفّذ النشر.
8. افتح رابط العامل وأضف `/ping` للاختبار.

## الحماية الاختيارية

يمكن إضافة Secret باسم `API_KEY`. عند إضافته يجب على التطبيق إرسال المفتاح في:

- `X-API-Key`
- أو `Authorization: Bearer ...`
- أو `apiKey` داخل JSON للحفاظ على توافق التطبيق القديم.

لا تضع المفتاح الحقيقي داخل GitHub.
