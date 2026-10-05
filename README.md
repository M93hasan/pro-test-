# Serula Dual Head — Sürüm 1

Senkron çalışan **tek kafa / çift kafa** lazer-CNC nesting uygulaması.

Bu proje `M93hasan/nesting` içindeki gerçek Serula geometri, DXF ve Sparrow/WASM nesting çekirdeğini kullanır; kaynak `nesting` reposu değiştirilmez.

## Sürüm

**1** — package version: **1.0.0**

## Makine modları

### Tek kafa

Standart Serula nesting davranışı kullanılır.

### Çift kafa – senkron

İki kafa aynı hareketi, aynı Y konumunu ve aynı dönüş açısını kullanır.

```text
Kafa 1: X
Kafa 2: X + kafaAralığı
```

Kafa aralığı kullanıcı tarafından milimetre cinsinden ayarlanır.

Sparrow, Kafa 1 için güvenli çalışma şeridinde nesting yapar:

```text
güvenli şerit = min(kafa aralığı, malzeme genişliği - kafa aralığı)
```

Bu sayede ikinci kafanın senkron kopyası malzeme dışına taşmadan ayrı fiziksel şeritte kalır.

> Sürüm 1'de parça adedi **kesim hareketi adedi** olarak değerlendirilir. Çift kafa modunda her hareket iki fiziksel parça üretir. Örneğin 10 hareket = 20 fiziksel kesim.

## Gerçek üretim akışı

1. DXF dosyasını aç.
2. Tek kafa veya Çift kafa – senkron seç.
3. Çift kafada kafa aralığını gir.
4. Rulo veya plaka malzeme ölçülerini ayarla.
5. **Nest** ile Sparrow/WASM motorunu çalıştır.
6. Kafa 1 ve Kafa 2 sonuçlarını önizle.
7. **DXF İndir** ile üretim dosyasını oluştur.

## DXF

Serula kaynak DXF mantığı korunur:

- LINE
- ARC
- CIRCLE
- SPLINE
- LWPOLYLINE / POLYLINE
- iç boşluklar
- bağlı detaylar ve yardımcı işaretler

Export sırasında mümkün olduğunda orijinal DXF entity tipi korunur; nesting için kullanılan polygonlaştırılmış geometri üretim DXF'ine zorla yazılmaz.

## Plaka modu

Plaka modu aynı Sparrow nesting yolunu kullanır. Taşan yerleşimler Plaka 2, Plaka 3… olarak devam eder.

DXF export'ta plakalar tek dosyada yan yana çıkar ve plaka arası yatay boşluk **50 mm**'dir.

## Teknoloji

- React 19
- TypeScript
- Vite 6
- Sparrow / Jagua Rust + WebAssembly
- DXF parser
- polygon-clipping / robust-predicates

## Geliştirme

```bash
npm install
npm test
npm run build
npm run dev
```

GitHub Actions her push'ta test ve production build kontrolü yapar.

## Kaynak referans

Serula çekirdeği referans alınan repo:

`https://github.com/M93hasan/nesting`

Bu yeni çift kafa projesi:

`https://github.com/M93hasan/pro-test-`


## Cloudflare Pages ile ücretsiz yayın

Alan adı satın almadan Cloudflare'ın ücretsiz `*.pages.dev` adresi kullanılabilir.

Cloudflare dashboard:

1. **Workers & Pages**
2. **Create application**
3. **Pages**
4. **Import an existing Git repository**
5. GitHub reposu: `M93hasan/pro-test-`
6. Production branch: `main`
7. Framework preset: **React (Vite)**
8. Build command: `npm run build`
9. Build output directory: `dist`
10. Root directory: boş bırak / repository root
11. **Save and Deploy**

Node.js sürümü repository kökündeki `.nvmrc` ile **22** olarak sabitlenmiştir.

İlk başarılı deploy'dan sonra Cloudflare ücretsiz bir `<proje-adı>.pages.dev` adresi verir. `main` dalına gelen yeni commitler otomatik olarak yeniden deploy edilir.
