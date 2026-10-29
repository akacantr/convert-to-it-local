# Convert to it! — Yerel Çevrimdışı Masaüstü Uygulaması

`https://p2r3.github.io/convert/` (`p2r3/convert`) projesinin tamamen yerel, %100 çevrimdışı (offline) çalışabilen ve yeni converter güncellemeleri geldiğinde kendini Git üzerinden akıllıca (delta güncelleme ile) güncelleyen masaüstü sürümüdür.

## Kurulum (GitHub'dan Klonlandığında)

Gereksinimler: **Git** ve **Bun** (veya proje içindeki `.runtime/bun/bun.exe`).

```powershell
git clone https://github.com/akacantr/convert-to-it-local.git
cd convert-to-it-local
bun install
bun run sync   # İlk çevrimdışı paketi (upstream + app-dist) indirir ve derler
bun run start  # Uygulamayı başlatır
```

İsteğe bağlı olarak masaüstü ve Başlat Menüsü kısayollarını oluşturmak için:
```powershell
powershell -ExecutionPolicy Bypass -File .\create-shortcuts.ps1
```

## Nasıl Başlatılır?

1. **Masaüstü veya Başlat Menüsü Kısayolu:**
   Masaüstünüzde ve Başlat Menüsünde oluşturulan **`Convert to it!`** kısayoluna çift tıklayarak doğrudan açabilirsiniz.
2. **Proje Klasöründen:**
   [`Convert-to-it.vbs`](./Convert-to-it.vbs) dosyasına çift tıklayarak konsol penceresi olmadan başlatabilirsiniz.
3. **Terminalden:**
   ```powershell
   bun run start
   # veya taşınabilir runtime ile:
   .\.runtime\bun\bun.exe run start
   ```

## Mimari ve Özellikler

- **Anında Çevrimdışı Açılış (`app-dist/`):** Uygulama açıldığında internet bağlantısı beklemeksizin doğrudan yerel diskteki `app-dist/` klasöründen (`app://-/index.html`) yüklenir. `SharedArrayBuffer` gerektiren tüm WebAssembly araçları (`ffmpeg`, `clang`, `7z`, `imagemagick` vb.) için gerekli COOP/COEP güvenlik başlıkları yerel protokol tarafından otomatik sağlanır.
- **Akıllı Git + Yerel Derleme ([`src/updater.cjs`](./src/updater.cjs)):**
  - Uygulama açıldıktan sonra internet bağlantısı varsa arka planda `upstream/` klasöründeki resmi `p2r3/convert` GitHub deposunu kontrol eder.
  - Sitedeki converter'lar güncellendiğinde 300 MB'lık tüm paketi baştan indirmek yerine **sadece değişen kodları** (`git fetch` + `git reset`) çeker ve Bun ile yerel olarak derler.
  - Sağ alt köşedeki durum çubuğunda derleme ilerlemesini gösterir ve tamamlandığında **"Yeni Sürüm Hazır • Yenile"** butonu sunar.
- **Farklı Kaydet Diyaloğu:** Dönüştürme işlemi tamamlanıp çıktı dosyası indirildiğinde Windows **"Farklı Kaydet"** penceresi açılarak nereye kaydedileceğini sorar ve son seçtiğiniz klasörü hatırlar.
