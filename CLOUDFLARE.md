# Cloudflare Workers + D1 дээр байршуулах

Cloudflare хувилбар нь `cloudflare/worker.js`, D1 миграци, `wrangler.jsonc` тохиргоог ашиглана. Сайт, админ, Excel импорт, эрх шалгах, Facebook хуваалцах болон холбогдох холбоос нэг Worker дээр ажиллана. Утас, эрх, админ бүртгэл, оруулсан зургийг D1-д хадгална. Excel-ийг админы браузер уншаад зөвхөн сонгосон багануудын мөрийг серверт явуулна. Cloudflare хувилбарт админаас оруулах зургийн дээд хэмжээ 1.5 МБ. Өмнөх Node/PostgreSQL өгөгдлийг автоматаар зөөхгүй. Шинэ D1-д анхны админаа үүсгэж, сугалаа болон Excel-ээ админ хэсгээс оруулна.

## 1. Анхны Worker болон өгөгдлийн сан

Windows-д Node.js 24, Git Bash ашиглана. `package.json` байгаа хавтсаас ажиллуулна.

```bash
npm ci
npx wrangler login
npx wrangler d1 create sukhbaataryn-hurd --location apac
```

D1 үүсгэхэд гарсан database ID-г `wrangler.jsonc`-ийн `d1_databases` доторх `DB` бичлэгт `"database_id": "ДЭЭРХ_UUID"` гэж нэмнэ. `binding`, `database_name`, `migrations_dir`-ээ хэвээр үлдээнэ.

```bash
npm run cf:migrate -- --remote
npm run cf:deploy
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

Нууц үг 14–160 тэмдэгттэй байна. Secret бүрийн утгыг асуух үед оруулна. Worker-ийн өгсөн `https://…workers.dev/admin/login` хаягаар анх нэвтрэхэд админы бүртгэл үүснэ. Нэвтэрч байгаагаа шалгасны дараа эдгээр хоёр түр secret-ийг Cloudflare dashboard-оос устгаж болно. Админы нууц үгийг D1-д хэшээр хадгална. Дараа нь админ хэсгээс сугалаагаа нээж, нийтэд харагдахаар тохируулаад Excel-ээ импортлоно.

## 2. GitHub-аас автоматаар шинэчлэх

Cloudflare файлуудыг GitHub репогийнхоо одоогийн хавтас руу хуулж, одоо байгаа Git түүх дээрээ commit хийнэ. `.git`, `node_modules` хавтас, Excel файл, нууц тохиргоогоо хуулж эсвэл GitHub-д оруулах шаардлагагүй. D1 database ID нь нууц үг биш тул `wrangler.jsonc`-тэй хамт commit хийж болно.

```bash
git add .
git commit -m "Add Cloudflare Workers and D1"
git push -u origin main
```

Cloudflare дээр **Workers & Pages → sukhbaataryn-hurd → Settings → Builds → Connect** гэж орж GitHub репогоо холбоно. Production branch нь `main`, root directory нь репогийн үндэс, deploy command нь `npx wrangler deploy`. Тусдаа build command шаардахгүй. GitHub-ийн push-оор Worker-ийн код шинэчлэгдэнэ. D1-д шинэ миграци нэмсэн тохиолдолд `npm run cf:migrate -- --remote`-г тусад нь ажиллуулна.

## 3. Дараа нь өөрийн домэйн холбох

Домэйнээ Cloudflare-д zone болгон нэмээд идэвхжүүлнэ. **Workers & Pages → sukhbaataryn-hurd → Settings → Domains & Routes → Add → Custom Domain** дээр өөрийн домэйн эсвэл дэд домэйныг оруулна. `workers.dev` хаягаас шилжихэд D1 өгөгдлөө дахин импортлохгүй. Facebook хуваалцах холбоосыг хүсэлт ирсэн домэйноор үүсгэнэ. Нэг албан ёсны хаяг ашиглах бол Worker-ийн Environment variable хэсэгт `PUBLIC_ORIGIN`-ийг тухайн бүтэн `https://...` хаягаар зааж болно.

## Локал туршилт

```bash
npm ci
npm run cf:migrate -- --local
npm run cf:dev
```

Локалд админ үүсгэх бол Git-д үл орох `.dev.vars` файлд `ADMIN_USERNAME`, `ADMIN_PASSWORD`-оо тавина. Багцлалт шалгахдаа `npm run cf:check` ашиглана.
