# Serula Dual Head Prototype

## Sürüm

**1** (package: 1.0.0)

Bu repo, senkron çalışan çift kesim kafalı makine için Serula uyarlamasının başlangıç projesidir.

## Makine modları

- Tek kafa
- Çift kafa – senkron

Çift kafa modunda ikinci kafa, birinci kafanın yaptığı aynı hareketi aynı açıyla uygular. İkinci kafanın fiziksel kesim konumu X ekseninde kafa aralığı kadar ötelenir:

    Kafa 1: X
    Kafa 2: X + kafaAraligi

Nesting ve doğrulama yalnızca ana yerleşimi değil, iki kafanın oluşturduğu bütün fiziksel kesimleri kontrol eder.

## İlk sürüm

- Kesim kafası seçimi
- Ayarlanabilir kafa aralığı
- Senkron ikinci kafa geometrisinin üretilmesi
- Malzeme sınırı kontrolü
- Kafalar ve yerleşimler arası çakışma kontrolü
- Canlı SVG önizleme
- Tek kafa davranışının korunması

## Çalıştırma

    npm install
    npm run dev

Test:

    npm test

Bu repo M93hasan/nesting reposundan ayrıdır. Orijinal tek kafa projesine dokunulmaz.
