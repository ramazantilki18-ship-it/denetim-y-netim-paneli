# 🚀 Saha Takip Sistemi — Özellik Planı ve Gereksinimler

> **Bu belge**, Denetim Yönetim Paneli ve Denetim App projesine eklenecek **Saha Takip** özelliğinin tüm gereksinimlerini içerir.
> Herhangi bir AI asistanı bu belgeyi okuyarak geliştirmeye devam edebilir.

---

## 📌 Proje Yapısı (Mevcut)

- **Web Admin Paneli**: `denetim_admin/` — HTML + JS + CSS (tek sayfa uygulama)
  - `index.html` — ana HTML yapısı
  - `script_v10.js` — ana JS mantığı
  - `style_v4.css` — ana CSS
  - `roster_view.js` — puantaj/kişisel istatistikler render mantığı
- **Mobil Uygulama (Flutter)**: `denetim_app/` — Flutter (Dart)
  - Firestore tabanlı, Provider state management
  - `lib/providers/auth_provider.dart` — yetkilendirme
  - `lib/widgets/bottom_nav_shell.dart` — alt bar navigasyon
  - `lib/screens/` — tüm ekranlar
- **Veritabanı**: Firebase Firestore
- **İstasyon Koordinatları**: Firestore'da zaten tanımlı (lat/lng mevcut)

---

## 🎯 Özellik Özeti

Bazı kullanıcılar sahaya çıktığında, GPS konum takibi ile:
1. Hangi istasyonda ne kadar süre kaldıklarını
2. İstasyonlar arası yolculuk sürelerini
3. Günlük toplam saha süresini

otomatik olarak kayıt altına alan bir sistem.

**ÖNEMLİ**: Bu özellik denetim sayısından **tamamen bağımsızdır**. Denetim ayrı bir modül, saha takip ayrı bir modüldür.

---

## 📱 Mobil Uygulama (Flutter) Gereksinimleri

### Kullanıcı Akışı

1. Kullanıcı uygulamada **"Sahadayım"** butonuna basar
2. GPS konum takibi başlar
3. Sistem, Firestore'daki istasyon koordinatlarına göre en yakın istasyonu otomatik algılar (geofencing, ~150-300m yarıçap)
4. İstasyonda kalma süresi sayılmaya başlar
5. Kullanıcı yeni istasyona yaklaştığında:
   - Önceki istasyondan çıkış kaydedilir
   - Yolculuk süresi hesaplanır
   - Yeni istasyona giriş kaydedilir
6. Uygulama arka planda çalışmaya devam eder (kapatılsa bile)
7. Son istasyonda **"Sahada Değilim"** butonuna basar → saha seansı kapanır

### Puantaj Entegrasyonu

- "Sahadayım" butonu **sadece puantajda vardiyası olan günlerde** aktif olur
- İzinli / OFF günlerde buton pasif kalır
- Her vardiya = **8 saat** mesai süresi üzerinden hesaplama yapılır

### Kaydedilecek Veriler (Firestore)

```
field_sessions/{sessionId}
├── userId: string
├── date: timestamp (gün)
├── startTime: timestamp (sahaya çıkış saati)
├── endTime: timestamp (sahadan dönüş saati)
├── totalDuration: number (dakika)
├── shiftCode: string (vardiya kodu)
├── status: "active" | "completed"
├── gpsTrail: [  // navigasyon izi için
│     { lat, lng, timestamp }
│   ]
├── visits: [
│     {
│       stationId: string,
│       stationName: string,
│       entryTime: timestamp,
│       exitTime: timestamp,
│       duration: number (dakika)
│     }
│   ]
├── travels: [
│     {
│       fromStation: string,
│       toStation: string,
│       startTime: timestamp,
│       endTime: timestamp,
│       duration: number (dakika)
│     }
│   ]
```

### Teknik Gereksinimler

- **Konum takibi**: `geolocator` + `flutter_background_service` paketleri
- **Geofencing**: İstasyon koordinatlarına göre sanal çember algılama
- **Batarya optimizasyonu**: Konum her 30-60 saniyede bir alınır
- **Offline destek**: Veriler yerel olarak kaydedilip sonra senkronize edilir
- **Android/iOS izinleri**: Arka plan konum izni

---

## 🖥️ Web Admin Paneli Gereksinimleri

Yeni bir menü öğesi: **"Saha Performans"** (sidebar'da)

### Sekme 1: 📊 Saha Matrisi

Mevcut "Kişisel İstatistikler" (roster_view.js içindeki renderPersonalStats) formatında:

- Satırlar: Kullanıcılar
- Sütunlar: Ayın günleri (1-31)
- Hücreler: O günkü toplam saha süresi (tıklanabilir)
- Renk kodlaması: 8s+ yeşil, 6-8s sarı, <6s kırmızı
- OFF/İzin günleri gri, saha kaydı yoksa "—"
- Ay/Yıl filtresi
- Excel çıktısı butonu

**Hücreye tıklayınca açılan detay:**
- İstasyon giriş/çıkış zaman çizelgesi (timeline)
- Her istasyondaki kalma süresi
- Yolculuk süreleri
- **"Haritada Göster"** butonu → harita açılır:
  - İstasyonlar pin olarak işaretli
  - GPS trail ile navigasyon rotası çizili (polyline)
  - Her pin üstünde kalma süresi baloncuğu
  - Rota çizgisi üstünde yolculuk süresi etiketi
  - Harita için Google Maps JS API veya Leaflet.js (ücretsiz)

### Sekme 2: 📈 Genel İstatistikler

**Filtreler (üst bar):**
- Kullanıcı seçimi (tekli / çoklu / tümü)
- Zaman dilimi: Günlük | Haftalık | Aylık | Yıllık | Tüm Zamanlar
- Tarih aralığı seçici

**Özet Kartlar:**
- Toplam saha günü sayısı
- Ortalama günlük saha süresi
- Saha verimlilik oranı (saha süresi / 8 saat %)
- Toplam ziyaret edilen istasyon sayısı
- Ortalama istasyon kalma süresi
- Toplam yolculuk süresi

**Çubuk Grafikler:**
- Kişi bazlı saha süresi (yatay çubuk)
- Günlük saha trendi (çizgi grafik)
- Haftalık karşılaştırma (gruplu çubuk)
- Saha vs Ofis oranı (yığın çubuk — 8 saatin ne kadarı saha, ne kadarı ofis)
- İstasyon yoğunluk haritası (ısı haritası)

### Sekme 3: 🏢 İstasyon Analizi

**Filtreler:** Hat, İstasyon, Tarih aralığı

- İstasyon bazlı toplam ziyaret sayısı
- İstasyon bazlı ortalama kalma süresi
- İstasyon bazlı ziyaretçi listesi (kim, ne zaman, ne kadar kalmış)
- En yoğun saatler (istasyonlar hangi saatlerde ziyaret ediliyor)
- İstasyonlar arası en sık rota (A→B→C en çok hangi sırayla gidilmiş)
- Çubuk grafikte istasyonlar süreye göre sıralı

### Sekme 4: 👤 Bireysel Performans

Kullanıcı seçimi → o kişiye özel dashboard:

- Aylık saha gün sayısı
- Aylık toplam saha süresi
- Ortalama sahaya çıkış saati
- Ortalama sahadan dönüş saati
- En çok ziyaret ettiği istasyonlar (Top 5)
- Hafta içi / hafta sonu karşılaştırması
- Ay ay trend (son 6-12 ayın grafiği)
- Günlük zaman çizelgesi (seçilen gün detay + harita)

### Sekme 5: 🚀 Karşılaştırma & Sıralama

- Liderlik tablosu (en çok sahada kalan kişiler — sıralı)
- Kişiler arası karşılaştırma (2-3 kişi yan yana)
- Hat bazlı performans (hangi hattaki ekip daha aktif)
- Hedef takibi (aylık saha hedefi vs gerçekleşen — opsiyonel)

### Her Sekmede Ortak

- Zaman filtresi: Günlük | Haftalık | Aylık | Yıllık | Tüm Zamanlar
- Excel çıktısı: o sekmedeki tüm verileri dışa aktarma
- Hat filtresi: belirli hatlara göre filtreleme

---

## 🔐 Yetkilendirme

- Saha takip özelliği belirli kullanıcılar için aktif olacak
- Mevcut Mobil Yetki Matrisi'ne (Ünvan bazlı) yeni bir sütun eklenebilir: "Saha Takip"
- Web paneldeki Saha Performans sayfası, Web Yetki Matrisi'ndeki izinlere göre görünür/gizlenir

---

## 📝 Notlar

- İstasyon koordinatları Firestore'da **zaten tanımlı** — ek veri girişi gerekmez
- Saha takip, denetim sayısından **tamamen bağımsız** bir modüldür
- Puantajdaki vardiya bilgisi ile entegre çalışır (sadece çalışma günlerinde aktif)
- Her vardiya 8 saat mesai üzerinden hesaplanır
