# CentrumChat Yapılacaklar

Bu dosya, planlanan geliştirmeleri ve devam eden çalışmaların güncel durumunu tek bir yerde takip
etmek için kullanılır. Buradaki kayıtlar hem kullanıcılar hem de coding agent'ları için ortak
çalışma hafızasıdır.

## Dosya nasıl düzenlenmeli?

- Her kategori ikinci seviye başlıkla (`##`), her yapılacak iş üçüncü seviye başlıkla (`###`)
  yazılmalıdır.
- Her işte sırasıyla `Açıklama`, `Öncelik`, `Efor` ve `Durum` alanları bulunmalıdır.
- Aynı işi tekrar eklemek yerine mevcut kayıt güncellenmelidir.
- Kullanıcının yazdığı kapsam, karar ve notlar korunmalıdır. Bir not artık geçerli değilse silmek
  yerine neden değiştiği yeni bir durum notuyla açıklanmalıdır.
- Bir işe başlanırken ana durum `Devam ediyor` yapılmalı ve gerçekleştirilen adımlar durum notlarına
  eklenmelidir.
- Durum notları istenildiği kadar ayrıntılı olabilir. Tamamlanan dosyalar, eksik kalan parçalar,
  alınan kararlar, karşılaşılan sorunlar ve sıradaki adım açıkça yazılabilir.
- Her durum notu `YYYY-MM-DD` tarihiyle başlamalıdır. Yeni notlar listenin en üstüne eklenmelidir.
- Her durum notunda, notu yazan agent'ın kendisine çalışma ortamı tarafından bildirilen model adı ve
  çalışma seviyesi yer almalıdır. Örnek: `Model: gpt5.6-sol high`. Agent model bilgisini tahmin
  etmemeli; çalışma seviyesi bildirilmemişse yalnızca model adını yazmalıdır.
- Öncelik veya efor sınıflandırması değiştirildiğinde, değişikliğin nedeni yeni bir tarihli durum
  notunda açıklanmalıdır.
- Bir iş yalnızca uygulama tamamlandığında ve gerekli kontrollerden geçtiğinde `Tamamlandı` olarak
  işaretlenmelidir. Son durum notunda yapılan kontroller belirtilmelidir.
- Bir işten vazgeçilirse kayıt silinmemeli; durum `İptal edildi` yapılmalı ve nedeni açıklanmalıdır.
- Dosya veya sembol adları ters tırnakla yazılmalıdır: `poll.ts`, `VoteService` gibi.

## Kullanılabilecek durumlar

- `Bekliyor`: Henüz başlanmadı.
- `Devam ediyor`: Üzerinde aktif olarak çalışılıyor veya tamamlanmamış parçaları var.
- `Tamamlandı`: Uygulandı ve gerekli kontrollerden geçti.
- `İptal edildi`: Yapılmamasına karar verildi.

## Sınıflandırma

Her iş iki ayrı ölçüte göre sınıflandırılır:

- `Öncelik`: İşin kullanıcıya, ürüne ve güvenliğe sağlayacağı değeri gösterir.
  - `Yüksek`: Temel kullanım, güvenlik, veri bütünlüğü veya geniş kullanıcı kitlesi için önemli.
  - `Orta`: Belirgin fayda sağlar ancak temel çalışma için zorunlu değildir.
  - `Düşük`: İyileştirici veya ileri seviye bir özelliktir; ertelenmesi temel deneyimi bozmaz.
- `Efor`: Migration, backend, protokol, istemci, operasyon ve testlerin toplam uygulama maliyetini
  gösterir.
  - `Düşük`: Sınırlı sayıda dosya ve mevcut yapıların küçük bir uzantısı.
  - `Orta`: Birden fazla katmanda koordineli değişiklik ve yeni testler gerektirir.
  - `Yüksek`: Yeni veri modeli veya kapsamlı altyapı, güvenlik ve uçtan uca çalışma gerektirir.

## Kapsam sınırı

Bu listeye, kullanıcı ayrıca istemediği sürece harici servis veya ayrı sunucu altyapısı gerektiren
işler eklenmemelidir. S3/MinIO, Passkey/WebAuthn, Google/GitHub OAuth, Redis, PostgreSQL,
SMTP/e-posta gönderimi, Web Push/mobil push, ödeme sağlayıcıları, harici antivirüs servisleri, dış
URL link önizlemeleri ve ses/görüntü görüşme altyapısı mevcut planın dışındadır.

## Yeni kayıt şablonu

```markdown
## Kategori

### Yapılacak şey

**Açıklama:** Yapılacak işin kapsamı, beklenen davranışı ve önemli sınırları.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- YYYY-MM-DD — Model: model-adı çalışma-seviyesi — Gerekliyse başlangıç notu veya henüz alınması
  gereken karar.
```

## Durum güncelleme örneği

```markdown
## Sohbet

### Poll sistemi

**Açıklama:** Kanallarda ve gruplarda seçenekler ile bitiş süresi içeren poll oluşturulabilmesi ve
kullanıcıların oy verebilmesi.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Devam ediyor`

- 2026-07-13 — Model: gpt5.6-sol high — `poll.ts` tamamlandı. `vote.ts` henüz yazılmadı; sıradaki
  adım oy verme servisinin ve ilgili testlerin eklenmesi.
- 2026-07-12 — Model: gpt5.6-sol high — Veri modeli ve istemci arayüzü hazırlandı; backend
  uygulaması bekliyor.
```

# Yapılacaklar

## Kullanıcı deneyimi

### Maintenance modu arayüzü

**Açıklama:** Maintenance modu etkinleştirildiğinde kullanıcıya anlaşılır bir banner, bakım
açıklaması ve isteğe bağlı tahmini bitiş zamanı gösterilmesi; değişiklik yapan kontrollerin arayüzde
devre dışı bırakılması.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Sabitlenmiş mesajlar

**Açıklama:** Yetkili kullanıcıların kanal ve grup mesajlarını sabitleyebilmesi, sabitlenen
mesajların konuşma içinde ayrı bir alanda listelenmesi ve sabitleme işlemlerinin denetlenmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Konuşma bazında susturma

**Açıklama:** Kullanıcının belirli bir kanal, grup veya DM için bildirimleri tamamen ya da belirli
bir süre boyunca susturabilmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Gerçek zamanlı profil güncellemesi

**Açıklama:** Avatar, görünen ad, renk ve benzeri profil değişikliklerinin `profile.updated` push
olayıyla bağlı istemcilere iletilmesi; istemcinin profilleri tekrar sorgulama ihtiyacının
azaltılması.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Davet bağlantıları

**Açıklama:** Grup ve uygun konuşmalar için süreli, kullanım sayısı sınırlı ve gerektiğinde iptal
edilebilir davet bağlantıları oluşturulması.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Mesaj yer imleri

**Açıklama:** Kullanıcıların erişebildikleri mesajları yalnızca kendi hesaplarında görünen kişisel
bir kayıt listesine ekleyebilmesi ve bu kayıtları kaldırabilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Kanal yavaş modu

**Açıklama:** Kanal bazında kullanıcıların iki mesajı arasında geçmesi gereken sürenin
ayarlanabilmesi; yetki muafiyetlerinin ve kalan süre bilgisinin sunucu tarafından uygulanması.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Duyuru kanalları

**Açıklama:** Yalnızca izin verilen moderator, admin veya owner hesaplarının mesaj yazabildiği;
diğer kullanıcıların salt okunur eriştiği kanal türü veya kanal ayarı eklenmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Arayüz ve erişilebilirlik

### Bağlantı durumu şeridi

**Açıklama:** WebSocket bağlantısının bağlanıyor, bağlı, yeniden bağlanıyor ve çevrimdışı
durumlarının sohbet arayüzünde kalıcı ancak dikkat dağıtmayan bir şeritle gösterilmesi; kullanıcıya
gerekli olduğunda elle yeniden deneme eylemi sunulması. Mevcut otomatik reconnect davranışı
korunmalı ve şerit bağlantı gerçekten düzeldiğinde kendiliğinden kapanmalıdır.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut istemcide otomatik reconnect bulunduğu ancak durumun
  kullanıcıya görünür olmadığı doğrulanarak planlama listesine eklendi.

### Mesaj gönderim durumları ve yeniden deneme

**Açıklama:** Gönderilen mesajların istemcide `Gönderiliyor`, `Gönderildi` ve `Gönderilemedi`
durumlarıyla gösterilmesi; başarısız mesajın içeriği kaybedilmeden yeniden denenebilmesi. Geçici
istemci kimliği ile sunucunun kalıcı mesaj kimliği güvenli biçimde eşleştirilmeli ve tekrar deneme
aynı mesajın yanlışlıkla iki kez oluşturulmasına yol açmamalıdır.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut gönderim hatalarının yalnızca console'a yazıldığı ve
  kullanıcıya tekrar deneme imkânı verilmediği doğrulanarak planlama listesine eklendi.

### Okunmamış mesaj ayıracı ve ilk okunmamış mesaja atlama

**Açıklama:** Konuşma açıldığında son okuma noktasından sonraki ilk mesajın önünde `Yeni mesajlar`
ayıracı gösterilmesi; kullanıcının ilk veya sonraki okunmamış mesaja tek eylemle atlayabilmesi.
Okuma imleci sunucu tarafındaki yetkili read-state verisine dayanmalı, yalnız istemci saatinden veya
yerel sayaçtan türetilmemelidir.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut unread badge ve `room.markRead` davranışının bulunduğu,
  ancak ilk okunmamış mesaj konumu ile konuşma içi ayıracın bulunmadığı doğrulanarak eklendi.

### Aşağı kaydırma yeni mesaj sayacı

**Açıklama:** Kullanıcı mesaj akışının sonunda değilken gelen yeni mesajların sayısının mevcut aşağı
kaydırma butonundaki badge üzerinde gösterilmesi; butona basıldığında sona gidilmesi ve sayacın
sıfırlanması. Konuşma değişiminde eski konuşmanın sayacı yeni konuşmaya taşınmamalıdır.

**Öncelik:** Yüksek

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. `scrollFabCount` store durumu; başka
  kullanıcının mesajı aktif konuşmaya akış sonda değilken gelince artıyor (99+ üst sınırlı badge);
  FAB tıklaması, akış sonuna iniş ve konuşma değişimi sıfırlıyor; sayaç eski konuşmadan yenisine
  taşınmıyor. Sayaç 0'dan büyükken FAB scroll olayı olmasa da görünür kılınıyor. FAB için eksik CSS
  eklendi (buton hiç stillenmemişti). Ayrıca sayaçla çakışan mevcut bir hata düzeltildi:
  `activeMessages` aboneliğindeki "son mesaj benimse dibe kaydır" kuralı, profil yenilemesi gibi
  dekoratif yeniden hesaplamalarda da tetiklenip kullanıcının kaydırma konumunu dibe zıplatıyordu;
  artık yalnız liste gerçekten büyüdüğünde çalışıyor. Dosyalar: `chat-store.js`, `chat.js`,
  `chat-handlers.js`, `chat-conversations.js`, `chat-messages.js`, `index.html`, `chat.css`.
  Testler: `tests/unit/frontendScrollUx.static.test.ts` + gerçek tarayıcıda (iki kullanıcı, canlı
  WS) sayaç artışı/badge/sıfırlama doğrulandı. Kontroller: `deno task check` ✓, `deno task lint` ✓,
  `deno fmt --check` ✓, `deno task test` 3× (368 passed / 0 failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: `scrollFabCount` store durumu;
  aktif konuşmaya kendi mesajı olmayan yeni mesaj geldiğinde ve akış sonda değilken artış; FAB'a
  basınca, akış sonuna inince ve konuşma değişince sıfırlama; badge'in reaktif bağlanması.
- 2026-07-14 — Model: GPT-5 Codex — `scrollFabBadge` işaretlemesinin mevcut olduğu fakat istemci
  kodunda sayacı güncelleyen davranış bulunmadığı doğrulanarak planlama listesine eklendi.

### Komut paleti ve hızlı geçiş

**Açıklama:** `Ctrl/Command + K` ile açılan ortak bir komut paletinden kanal, grup, DM, kullanıcı,
ayar ve izin verilen temel eylemlere klavyeyle erişilebilmesi. Sonuçlar mevcut yetkilendirme ve
görünürlük sınırlarına uymalı; arayüzde gösterilen komutlar sunucu yetkilendirmesinin yerine
geçmemelidir.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Çalışan istemcide genel amaçlı komut paleti veya hızlı konuşma
  değiştirici bulunmadığı doğrulanarak planlama listesine eklendi.

### Konuşma favorileri ve kişisel sıralama

**Açıklama:** Kullanıcının kanal, grup ve DM'leri favorileyebilmesi; konuşma bölümlerini daraltması
ve favoriler içinde kişisel bir sıralama belirleyebilmesi. Tercihler hesaba bağlı saklanmalı,
konuşmaya erişim kalktığında stale favoriler güvenli biçimde temizlenmelidir.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut hedef seçicide arama bulunduğu, ancak favorileme, kişisel
  sıralama ve bölüm daraltma seçeneklerinin bulunmadığı doğrulanarak eklendi.

### Genel klavye kısayolları

**Açıklama:** Konuşmalar arasında gezinme, arama açma, aktif mesaja cevap verme veya düzenleme,
okunmuş işaretleme ve composer'a odaklanma gibi sık kullanılan işlemler için klavye kısayolları
eklenmesi; kısayolların listelendiği erişilebilir bir yardım penceresi sunulması. Form alanlarında
yazı yazarken çakışan global kısayollar çalışmamalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Composer Enter davranışı dışında kapsamlı bir klavye kısayol
  sistemi bulunmadığı doğrulanarak planlama listesine eklendi.

### Panodan dosya ve görsel yapıştırma

**Açıklama:** Composer odaktayken panodaki görsel veya dosyanın `Ctrl/Command + V` ile mevcut
güvenli attachment yükleme akışına eklenmesi; metin yapıştırma davranışının bozulmaması ve kullanıcı
onayından önce dosyanın otomatik gönderilmemesi.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Dosya seçimi, sürükle-bırak ve URL'den alma bulunduğu; doğrudan
  Clipboard API/paste dosya akışının bulunmadığı doğrulanarak eklendi.

### Devam eden yüklemeyi iptal etme

**Açıklama:** Dosya yükleme ilerleme arayüzüne iptal eylemi eklenmesi; istemcinin aktif
`XMLHttpRequest` isteğini durdurması ve sunucuda dosya ya da attachment satırı oluşmuşsa mevcut
temizlik kurallarıyla orphan veri bırakılmaması. İptal ve gerçek ağ hatası kullanıcıya farklı
durumlar olarak gösterilmelidir.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — XHR upload progress göstergesinin bulunduğu, fakat aktif
  yüklemeyi iptal eden bir kontrol bulunmadığı doğrulanarak planlama listesine eklendi.

### Mesaj yoğunluğu ve ardışık mesaj gruplama

**Açıklama:** Kullanıcının rahat ve kompakt mesaj yoğunluğu arasında seçim yapabilmesi; aynı
kullanıcının kısa aralıklarla gönderdiği ardışık mesajlarda tekrar eden avatar, ad ve boşlukların
görsel olarak gruplanması. Tarih ayraçları, cevaplar, sistem mesajları ve farklı günler grup sınırı
oluşturmalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Gelen/giden mesaj sınıfları ve tarih ayraçları mevcut olsa da
  yoğunluk tercihi ile aynı yazara ait ardışık mesaj gruplaması bulunmadığı doğrulanarak eklendi.

### Sistem temasını takip etme

**Açıklama:** Mevcut açık ve koyu tema seçeneklerine `Sistem` seçeneği eklenmesi; işletim sistemi
tema değişikliklerinin `prefers-color-scheme` üzerinden canlı uygulanması. Kullanıcının açık veya
koyu temayı elle seçmesi sistem takibini devre dışı bırakmalıdır.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Chat ve Control Center'da açık/koyu tema bulunduğu, ancak gerçek
  bir `Sistem` modu bulunmadığı doğrulanarak planlama listesine eklendi.

### Erişilebilirlik tercihleri

**Açıklama:** Yazı boyutu, yüksek kontrast ve azaltılmış animasyon tercihlerinin eklenmesi; yeni
mesajlar ile bağlantı/gönderim durumlarının ekran okuyuculara uygun canlı bölgeler üzerinden
duyurulması. Klavye odağı, modal focus yönetimi ve renk dışındaki durum göstergeleri chat ile
Control Center'da birlikte test edilmelidir.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Temel `focus-visible` stilleri ve bazı ARIA etiketleri mevcut;
  kullanıcıya ait yazı boyutu, yüksek kontrast, reduced-motion ve canlı mesaj tercihleri bulunmadığı
  doğrulanarak eklendi.

### Mobil uzun basma mesaj eylem paneli

**Açıklama:** Dokunmatik cihazlarda bir mesaja uzun basıldığında reaksiyon, cevapla, kopyala,
raporla ve yetkiye göre düzenle/sil eylemlerinin erişilebilir bir bottom-sheet içinde gösterilmesi.
Tarayıcının metin seçimi ve ekran okuyucu alternatifleri korunmalı; yalnız hover'a bağımlı kontrol
kalmamalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mobil uyumlu modal ve emoji picker bulunduğu, ancak mesaj
  eylemleri için uzun basma/bottom-sheet akışı bulunmadığı doğrulanarak planlama listesine eklendi.

### Konuşma boş ve hata durumları

**Açıklama:** Mesajsız kanal, grup veya DM; arama sonucu bulunamaması; geçmişin yüklenememesi ve
erişimin kaldırılması gibi durumlar için açıklayıcı, eylem odaklı ve erişilebilir boş/hata
görünümleri hazırlanması. Yeniden deneme yalnız güvenli ve idempotent okuma işlemlerinde
sunulmalıdır.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Genel splash ve toast yapıları mevcut olsa da konuşma ve arama
  bazında tutarlı boş/hata bileşenleri bulunmadığı doğrulanarak planlama listesine eklendi.

### Mesaj kalıcı bağlantısı ve kopyalama eylemleri

**Açıklama:** Kullanıcının erişebildiği bir mesajın metnini veya kalıcı bağlantısını
kopyalayabilmesi; bağlantı açıldığında ilgili konuşmanın yüklenip hedef mesajın ekranda
vurgulanması. Erişimi olmayan, silinmiş veya artık mevcut olmayan mesajlarda içerik sızdırmadan
uygun hata görünümü gösterilmelidir.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mesaj eylemlerinde metin veya bağlantı kopyalama ve URL/hash
  üzerinden hedef mesaja açılma davranışı bulunmadığı doğrulanarak planlama listesine eklendi.

### Okundu bilgisi ve gören kullanıcılar

**Açıklama:** DM mesajlarında `Görüldü` durumunun, uygun büyüklükteki grup konuşmalarında ise mesajı
okuyan kullanıcıların gösterilmesi. Bilgi sunucu read-state verisinden üretilmeli; görünürlük,
gizlilik tercihi ve büyük gruplar için kullanıcı/sayı sınırları açıkça belirlenmelidir.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Konuşma okuma durumu tutulduğu halde mesaj bazında `Görüldü`
  veya gören kullanıcılar arayüzü ve gizlilik politikası bulunmadığı doğrulanarak eklendi.

### Konuşma başına kaydırma konumunu koruma

**Açıklama:** Kullanıcı başka bir konuşmaya geçip geri döndüğünde önceki görünür mesajına ve
kaydırma konumuna dönmesi; yeni mesajlar geldiyse konum korunurken okunmamış göstergelerin doğru
çalışması. Saklanan konum silinmiş bir mesaja aitse en yakın geçerli mesaja güvenli fallback
yapılmalıdır.

**Öncelik:** Yüksek

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. `chat-conversations.js` içinde oturum
  içi (kalıcı olmayan) konum haritası: konuşmadan ayrılırken görünür ilk 3 mesajın çapa id'leri +
  ofsetleri ve ham `scrollTop` saklanıyor; dönüşte ilk bulunan çapaya aynı ofsetle dönülüyor, çapa
  mesajlar silinmişse ham değere kelepçeli fallback yapılıyor; kullanıcı akış sonundaysa kayıt
  tutulmayıp varsayılan sona-kaydırma davranışı korunuyor. Geri yükleme `activeMessages`
  aboneliğinde takip-davranışından önce uygulanıyor; unread rozetleri etkilenmiyor (konuşma açılışı
  rozetini zaten sıfırlıyor). Testler: `tests/unit/frontendScrollUx.static.test.ts` + gerçek
  tarayıcıda konuşma değiştirip dönünce konumun (±150px) geri geldiği doğrulandı. Kontroller:
  `deno task check` ✓, `deno task lint` ✓, `deno fmt --check` ✓, `deno task test` 3× (368 passed / 0
  failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: konuşmadan ayrılırken görünür
  ilk mesajların (birkaç aday çapa id + ofset) oturum içi bellekte saklanması; dönüşte çapa mesaj
  bulunursa aynı konuma, silinmişse sıradaki geçerli çapaya, hiçbiri yoksa kaydırma değerine güvenli
  fallback; kullanıcı akışın sonundaysa varsayılan sona-kaydırma davranışının korunması.
- 2026-07-14 — Model: GPT-5 Codex — Konuşma değişimlerinde geçmiş yeniden yüklenirken konuşma
  bazında görünür mesaj/kaydırma konumunun saklanmadığı doğrulanarak planlama listesine eklendi.

### Kaydırma sırasında sabit tarih başlığı

**Açıklama:** Mesaj geçmişi kaydırılırken o anda ekranda bulunan mesajların tarihinin akışın üstünde
sabit bir başlık olarak gösterilmesi; mevcut tarih ayraçlarıyla aynı yerel tarih biçimlendirmesini
kullanması ve tarih değişimlerinde dikkat dağıtmadan güncellenmesi.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Akış içinde tarih ayraçları mevcut; kaydırmayla güncellenen
  sticky tarih başlığı bulunmadığı doğrulanarak planlama listesine eklendi.

### Masaüstü konuşma kenar çubuğu

**Açıklama:** Geniş ekranlarda kanal, grup ve DM listesinin mevcut hedef dropdown'una alternatif
olarak kalıcı bir sol panelde gösterilmesi; dar ekranlarda mevcut mobil düzenin korunması. Panel
arama, unread badge, favoriler ve konuşma bazlı eylemler için ortak gezinme yüzeyi olmalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Ana chat istemcisinin konuşma seçimini dropdown üzerinden
  yaptığı ve geniş ekranlara özel kalıcı konuşma paneli bulunmadığı doğrulanarak eklendi.

### Boyutlandırılabilir arayüz panelleri

**Açıklama:** Masaüstü konuşma listesi, mesaj alanı ve ayrıntı paneli genişliklerinin erişilebilir
sürükleme tutamaçları veya klavye kontrolleriyle değiştirilebilmesi; seçimin yerel olarak saklanması
ve güvenli minimum/maksimum genişliklerle düzenin bozulmasının önlenmesi.

**Öncelik:** Düşük

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut responsive yerleşimde kullanıcı tarafından
  boyutlandırılabilen panel bulunmadığı doğrulanarak planlama listesine eklendi.

### Konuşma ayrıntı çekmecesi

**Açıklama:** Aktif konuşmanın üyeleri, bildirim tercihleri ve temel bilgileri için ortak bir sağ
çekmece oluşturulması; sabitlenmiş mesajlar ile medya/dosya galerisi tamamlandığında aynı çekmeceye
sekme olarak bağlanması. İçerik yalnız kullanıcının erişebildiği konuşma verilerini göstermelidir.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Üye ve ayar işlemlerinin ayrı modal/alanlarda bulunduğu, konuşma
  araçlarını birleştiren kalıcı ayrıntı çekmecesi bulunmadığı doğrulanarak eklendi.

### Tarayıcı sekmesi ve favicon okunmamış sayacı

**Açıklama:** Toplam okunmamış konuşma/bildirim sayısının tarayıcı sekmesi başlığında ve uygun
olduğunda favicon badge üzerinde gösterilmesi; sekme aktifleşip ilgili içerik okunduğunda sayacın
güncellenmesi. Sayaç erişilebilir başlık metnini bozmayacak ve gereksiz sık DOM güncellemesi
yapmayacaktır.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Unread bilgisi istemcide bulunmasına rağmen `document.title`
  veya favicon üzerinde gösterilmediği doğrulanarak planlama listesine eklendi.

### Çoklu kullanıcı yazıyor göstergesi

**Açıklama:** Aynı konuşmada birden fazla kullanıcı yazarken `Ayşe, Mehmet ve 3 kişi yazıyor`
benzeri özet gösterilmesi; kullanıcıların zaman aşımı bağımsız izlenmeli ve uzun isim listeleri
erişilebilir biçimde sınırlandırılmalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut arayüzün tek bir `typingState` gösterdiği, eşzamanlı
  yazan kullanıcıları birlikte takip edip özetlemediği doğrulanarak planlama listesine eklendi.

### Süreli özel kullanıcı durumu

**Açıklama:** Kullanıcının emoji, kısa durum metni ve isteğe bağlı sona erme süresi
belirleyebilmesi; durumun profil kartı, konuşma üyeleri ve ilgili kullanıcı yüzeylerinde
gösterilmesi. Metin uzunluğu, temizleme, gerçek zamanlı güncelleme ve süresi dolan durumların
kaldırılması sunucu tarafından uygulanmalıdır.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Çevrimiçi/boşta/rahatsız etmeyin durumları mevcut; özel emoji,
  metin ve expiry içeren kullanıcı durumu bulunmadığı doğrulanarak eklendi.

### Seçili metinle alıntılı cevap

**Açıklama:** Kullanıcının bir mesajın belirli bölümünü seçerek cevaba güvenli bir alıntı olarak
ekleyebilmesi; alıntının kaynak mesajla bağı korunurken istemci tarafından değiştirilen metnin
orijinal içerik gibi sunulmaması. Silinen veya düzenlenen kaynak mesaj davranışı açıkça
belirlenmelidir.

**Öncelik:** Düşük

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Tam mesaja cevap verme mevcut; seçili metin aralığıyla alıntılı
  cevap oluşturma bulunmadığı doğrulanarak planlama listesine eklendi.

### Çoklu mesaj seçim modu

**Açıklama:** Kullanıcının erişebildiği bir veya birden fazla mesajı seçim moduna alarak metinleri
kopyalayabilmesi; mesaj yönlendirme, yer imi ve yetkili toplu silme işleri tamamlandığında aynı
seçim altyapısının bu eylemlere bağlanması. Her eylem kendi sunucu yetkisini yeniden doğrulamalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mesajların yalnız tekil eylem butonlarıyla işlendiği ve çoklu
  seçim durumu bulunmadığı doğrulanarak planlama listesine eklendi.

### Uzun geçmiş için sanal mesaj listesi

**Açıklama:** Çok uzun konuşmalarda yalnız görünür mesajlar ve kontrollü overscan bölgesinin DOM'da
tutulması; cursor sayfalama, hedef mesaja atlama, tarih ayraçları, değişken mesaj yüksekliği ve
kaydırma konumu korumasıyla birlikte çalışması. Ekran okuyucu kullanımında mesajların erişilebilir
sırası bozulmamalıdır.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut reactive render'ın yüklü mesajları DOM'a doğrudan bastığı
  ve pencereleme/virtualization kullanmadığı doğrulanarak planlama listesine eklendi.

### Odak modu

**Açıklama:** Kullanıcının konuşma seçici, üst araçlar ve ikincil panelleri geçici olarak gizleyip
mesaj akışı ile composer'a odaklanabilmesi; moddan klavye ve görünür bir çıkış kontrolüyle kolayca
dönülebilmesi.

**Öncelik:** Düşük

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. `chat-store.js` içine kalıcı olmayan
  `focusMode` durumu ve `focusModeClass` computed'ı; `index.html` header'ına aç/kapat butonu, kart
  köküne sınıf bağlama ve odak modundayken görünen `Exit focus` çıkış kontrolü; `chat.css` odak
  modunda `chat-header` ile arama çubuğunu gizliyor; `chat.js` içindeki `Escape` çıkışı açık
  Bootstrap modalı varken tetiklenmiyor; logout durumu sıfırlıyor (`chat-auth.js`). Testler:
  `tests/unit/frontendFocusMode.static.test.ts` (4 test) + gerçek tarayıcıda (chromium/puppeteer,
  geçici sunucu) aç/kapat, `Escape` ve çıkış butonu doğrulandı. Kontroller: `deno task check` ✓,
  `deno task lint` ✓, `deno fmt --check` ✓, `deno task test` 3× (350 passed / 0 failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: `focusMode` store durumu,
  header'da aç/kapat butonu, odak modunda header ile arama çubuğunu gizleyen CSS, görünür bir
  `Exit focus` çıkış kontrolü ve `Escape` ile çıkış (açık modal varken tetiklenmeden); davranışı
  sabitleyen statik test.
- 2026-07-14 — Model: GPT-5 Codex — Tam ekran mesaj odak modu bulunmadığı doğrulanarak planlama
  listesine eklendi.

### İlk kullanım arayüz turu

**Açıklama:** Kayıt/onboarding akışından ayrı olarak konuşma seçici, arama, profil, bildirimler ve
mesaj eylemlerini tanıtan kısa ve atlanabilir bir ürün turu sunulması; tamamlanma durumunun
kullanıcı tercihlerinde saklanması ve turu ayarlardan yeniden başlatma seçeneği verilmesi.

**Öncelik:** Düşük

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Planlanan kayıt tercih onboarding'inden farklı olarak çalışan
  chat arayüzünü tanıtan bir ürün turu bulunmadığı doğrulanarak planlama listesine eklendi.

## Sohbet

### Mesaj thread'leri

**Açıklama:** Mevcut cevap ilişkisi temel alınarak bir mesaja bağlı yanıtların ayrı bir thread
görünümünde listelenmesi, sayılması ve gerçek zamanlı güncellenmesi.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Poll sistemi

**Açıklama:** Kanal ve gruplarda seçenekler ile oylama süresi içeren poll oluşturulması. Poll
oluşturan kullanıcı, oluşturma formunda oy veren kullanıcıların kimliklerinin görünür olup
olmayacağını, verilen oyun sonradan değiştirilip değiştirilemeyeceğini ve sonuçların oy vermeden
önce görülüp görülemeyeceğini belirleyebilmelidir. Seçilen kurallar poll ömrü boyunca sunucu
tarafından uygulanmalı ve sonuçlar süre sonunda kapatılmalıdır.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Ürün kararı güncellendi: oy verenlerin görünürlüğü, oy
  değiştirme izni ve sonuçların oy öncesinde görünürlüğü poll oluşturma sırasında kullanıcıya
  sorulacak; bu tercihler poll kaydında kalıcı olarak saklanacak.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Mesaj yönlendirme

**Açıklama:** Kullanıcının erişebildiği bir mesajı, hedef konuşmaya erişim ve engelleme kuralları
korunarak başka bir kanal, grup veya DM'e yönlendirebilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Taslak mesajlar

**Açıklama:** Gönderilmemiş mesaj içeriğinin konuşma bazında saklanması ve kullanıcı konuşmalar
arasında geçiş yaptığında taslağın geri yüklenmesi.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. Taslaklar hesaba bağlı
  `chat_drafts_<userId>` `localStorage` anahtarında konuşma anahtarına (destKey) göre saklanıyor;
  konuşma değişiminde eski taslak kaydedilip yenisi composer'a geri yükleniyor; yazarken 500 ms
  debounce ile kalıcılaştırılıyor (debounce sırasında konuşma değişirse yanlış anahtara yazmayı
  önleyen koruma var); gönderim composer'ı boşalttığı için taslağı otomatik temizliyor; boş
  taslaklar haritadan siliniyor, harita boşalınca anahtar kaldırılıyor; login taslakları yükleyip
  aktif konuşmanınkini composer'a koyuyor, logout store'u sıfırlıyor. Dosyalar:
  `chat-conversations.js`, `chat-store.js`, `chat.js`, `chat-handlers.js`, `chat-auth.js`. Testler:
  `tests/unit/frontendDrafts.static.test.ts` + gerçek tarayıcıda konuşmalar arası kaydet/geri yükle
  ve `localStorage` içeriği doğrulandı. Kontroller: `deno task check` ✓, `deno task lint` ✓,
  `deno fmt --check` ✓, `deno task test` 3× (368 passed / 0 failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Karar: taslaklar arama geçmişiyle
  aynı kalıpta, hesaba bağlı `chat_drafts_<userId>` `localStorage` anahtarında konuşma anahtarına
  (destKey) göre saklanacak; konuşma değişiminde kaydet/geri yükle, yazarken debounce ile kalıcı
  hale getirme, gönderimde temizleme, logout'ta store sıfırlama.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Zamanlanmış mesajlar

**Açıklama:** Kullanıcının mesaj için gelecekte bir gönderim zamanı belirleyebilmesi; zamanlanan
mesajların kalıcı olarak saklanması, iptal edilebilmesi ve sunucu yeniden başlasa da gönderilmesi.

**Öncelik:** Düşük

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Markdown, BBCode ve kod bloğu desteği

**Açıklama:** Mesajlarda güvenli bir Markdown alt kümesinin yanında BBCode biçimlendirmesinin
desteklenmesi. En az `[b]kalın[/b]`, `[i]italik[/i]` ve `[s]üstü çizili[/s]` etiketleri ile satır
içi kod ve kod blokları XSS oluşturmadan görüntülenmelidir. Parser yalnız allow-list etiketleri
kabul etmeli; iç içe etiket derinliği ve çıktı boyutu sınırlandırılmalı, bilinmeyen veya bozuk
etiketler güvenli düz metin olarak kalmalıdır. Markdown ile BBCode çakışmalarında ayrıştırma sırası
açıkça tanımlanmalı; arama, bildirim önizlemesi, düzenleme ve alıntılar anlamlı düz metin fallback'i
kullanmalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Kullanıcı kararıyla mevcut mesaj biçimlendirme kapsamına güvenli
  BBCode desteği eklendi; ilk zorunlu etiketler `[b]`, `[i]` ve `[s]` olarak belirlendi.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Bilinen URL bağlantı kartları

**Açıklama:** Mesaj içindeki allow-list'e alınmış URL türlerinin güvenli ve sağlayıcıya özel kompakt
kart/çip olarak gösterilmesi. İlk sağlayıcı GitHub repository bağlantıları olmalı;
`https://github.com/mhmtsnmzkanly/centrum-chat` mesaj içinde örneğin
`[ @mhmtsnmzkanly / centrum-chat ]` biçiminde, özgün URL'ye giden erişilebilir bir bağlantı olarak
görünmelidir. İlk sürüm URL yolunu yerel olarak ayrıştırmalı ve harici API/fetch gerektirmemelidir;
provider registry yalnız bilinen host ve path kalıplarını kabul etmeli, kullanıcı adı/repo adı
escape edilmeli, yanıltıcı hostlar (`github.com.example.org`) eşleşmemeli ve dış bağlantılar güvenli
`rel` özellikleriyle açılmalıdır. Gelecekte metadata alınacaksa SSRF, timeout, cache, boyut limiti
ve gizlilik tasarımı ayrıca onaylanmalıdır.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Kullanıcı kararıyla bilinen URL kartları planlandı. İlk kapsam
  dış API kullanmadan GitHub repository URL'sinden `@owner / repository` şablonu üretmek olarak
  sınırlandırıldı; diğer provider'lar daha sonra allow-list'e eklenebilir.

### Gelişmiş mention sistemi

**Açıklama:** Mevcut kullanıcı mention'larına ek olarak izin kontrollü `@everyone` ve `@moderators`
mention'ları, bildirim fanout'u ve kötüye kullanım sınırları eklenmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Mesaj geçmişinde gelişmiş sayfalama

**Açıklama:** Büyük konuşmalarda eski ve yeni mesajların kararlı cursor tabanlı sayfalama ile
yüklenmesi; istemcide yukarı kaydırarak geçmiş yükleme deneyiminin iyileştirilmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Mesaj tarihinde belirli güne atlama

**Açıklama:** Kullanıcının takvimden bir tarih seçerek konuşmadaki o güne en yakın mesaja
gidebilmesi ve çevresindeki mesajları yükleyebilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Konuşma medya ve dosya galerisi

**Açıklama:** Kullanıcının erişebildiği konuşmadaki görsel, video ve diğer ekleri türlerine göre
filtreleyerek ayrı bir galeride görebilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Arama

### SQLite FTS5 tam metin arama

**Açıklama:** Mevcut `LIKE` tabanlı mesaj aramasının SQLite FTS5 indeksleriyle geliştirilmesi;
ekleme, düzenleme ve silme işlemlerinde indeks tutarlılığının korunması.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Global mesaj araması

**Açıklama:** Kullanıcının yalnızca erişebildiği kanal, grup ve DM'lerde tek sorguyla mesaj
arayabilmesi; özel konuşmaların sonuçlar üzerinden sızdırılmaması.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Gelişmiş arama filtreleri

**Açıklama:** Mesaj aramasına tarih aralığı, gönderen kullanıcı, konuşma ve dosya türü filtreleri
eklenmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Arama sonucu vurgulama

**Açıklama:** Aranan kelimelerin sonuç önizlemelerinde güvenli biçimde vurgulanması ve sonucun
konuşma içindeki gerçek mesaja bağlanması.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Arama geçmişi

**Açıklama:** Son aramaların kullanıcı hesabında veya yalnızca yerel istemcide yönetilebilir şekilde
saklanması; geçmişin tek tek ya da tamamen temizlenebilmesi.

**Öncelik:** Düşük

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. Mesaj arama çubuğunun altında
  `Recent
  searches` paneli: son 10 sorgu, yeniden çalıştırma (chip tıklama), tek tek silme (×) ve
  `Clear
  all`. Kayıt Enter ile anında veya canlı arama başarılı olup yazma 1.2 sn duraklayınca;
  mükerrer sorgu öne taşınır. Saklama yalnızca yerel: hesaba bağlı `chat_search_history_<userId>`
  `localStorage` anahtarı (sunucuya hiçbir arama geçmişi gönderilmez); tamamen temizlemede anahtar
  silinir; logout store'daki geçmişi sıfırlar. Panel yalnızca arama çubuğu açık ve girdi boşken
  görünür, sonuçların üstünü örtmez. Değişen dosyalar: `web/index.html`,
  `web/scripts/chat-store.js`, `web/scripts/chat-handlers.js`, `web/scripts/chat.js`,
  `web/scripts/chat-auth.js`, `web/styles/chat.css`. Testler:
  `tests/unit/frontendSearchHistory.static.test.ts` (5 test) + gerçek tarayıcıda
  kayıt/dedupe/yeniden çalıştırma/silme/temizleme ve `localStorage` anahtarının kalkması doğrulandı.
  Kontroller: `deno task check` ✓, `deno task lint` ✓, `deno fmt --check` ✓, `deno task test` 3×
  (350 passed / 0 failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Karar: geçmiş yalnızca yerel
  istemcide, hesaba (kullanıcı id'sine) bağlı `localStorage` anahtarında saklanacak (açıklamadaki
  "yalnızca yerel istemcide" seçeneği; sunucu değişikliği gerektirmez). Kapsam: mesaj arama
  çubuğunda son 10 sorgu; Enter veya duraklama ile kayıt; tek tek silme ve tümünü temizleme; çıkışta
  store'dan sıfırlama.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Moderasyon ve yönetim

### Otomatik kelime ve URL filtresi

**Açıklama:** Yönetilebilir kurallarla belirli kelime ve URL kalıplarının reddedilmesi, maskelenmesi
veya moderasyon incelemesine gönderilmesi; eşleşmelerin denetim kaydına alınması.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Spam ve flood algılama

**Açıklama:** Tekrarlanan içerik, aşırı mention ve kısa sürede yoğun mesaj gibi davranışların
sunucuda tespit edilmesi; eşiklerin ayarlanabilir olması ve yanlış pozitiflerin izlenmesi.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Kanal bazında yetkiler

**Açıklama:** Kanal özelinde görüntüleme, mesaj gönderme, moderasyon ve yönetim izinlerinin merkezi
yetki politikalarıyla tanımlanması.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Geçici uzaklaştırma

**Açıklama:** Kullanıcıların belirli bir konuşmadan süreli olarak uzaklaştırılması; başlangıç,
bitiş, uygulayan yetkili ve neden bilgilerinin kalıcı olarak tutulması.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Toplu mesaj silme

**Açıklama:** Yetkili kullanıcıların kapsam ve zaman aralığı belirleyerek mesajları topluca soft
delete yapabilmesi; işlemin sınırlandırılması ve denetlenmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Moderatör kullanıcı notları

**Açıklama:** Yetkililerin kullanıcı hakkında yalnızca moderasyon alanında görülebilen, yazarı ve
tarihi belli dahili notlar tutabilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Moderatörler arası dahili notlar

**Açıklama:** Rapor ve yaptırım kayıtlarında moderator ekibinin kullanıcıya gösterilmeyen çalışma
notları ve devir bilgileri paylaşabilmesi.

**Öncelik:** Düşük

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Rapor istatistikleri

**Açıklama:** Rapor sayısı, neden dağılımı, sonuçlanma süresi ve durum değişimleri gibi ölçümlerin
Control Center içinde gösterilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Kullanım istatistikleri

**Açıklama:** Aktif kullanıcı, yeni hesap, konuşma ve mesaj hacmi gibi kişisel veri içermeyen toplu
ölçümlerin yönetim panelinde sunulması.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Bakım duyuruları

**Açıklama:** Yetkililerin bakım öncesi ve sırasında başlık, açıklama, başlangıç ve tahmini bitiş
zamanı içeren sistem duyuruları yayınlayabilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Denetim kayıtlarını dışa aktarma

**Açıklama:** Yetkili kullanıcıların filtrelenmiş audit kayıtlarını boyut ve tarih sınırlarıyla JSON
veya CSV olarak indirebilmesi; dışa aktarma işleminin de denetlenmesi.

**Öncelik:** Orta

**Efor:** Düşük

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Bildirimler

### Konuşma bazında bildirim tercihleri

**Açıklama:** Her kanal, grup ve DM için tüm bildirimler, yalnızca mention veya sessiz
seçeneklerinin kullanıcı bazında saklanması ve fanout sırasında uygulanması.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Yalnızca mention bildirimleri

**Açıklama:** Kullanıcının genel veya konuşma bazında yalnızca doğrudan mention edildiğinde kalıcı
bildirim alabilmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Bildirimleri topluca silme

**Açıklama:** Kullanıcının bildirimlerini seçerek ya da tamamını tek işlemle silebilmesi; yalnızca
kendi bildirimlerinin etkilenmesi.

**Öncelik:** Düşük

**Efor:** Düşük

#### Durum

`Devam ediyor`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Sunucu tarafı tamamlandı; yalnızca istemci arayüzü
  bekliyor. Yeni `notification.delete` WS eventi: `{ ids: string[] }` (en fazla 100) veya
  `{ all: true }` alır, `{ deletedCount }` döner. Silme repository'de `user_id` kapsamıyla yapılır;
  başka kullanıcıya ait ya da bilinmeyen id'ler sessizce atlanır (bilgi sızıntısı yok, idempotent).
  Event maintenance-mode mutasyon kapısına (`MUTATION_EVENTS`) eklendi. Değişen dosyalar:
  `src/application/websocket/handlers/notifications/deleteNotificationsHandler.ts` (yeni),
  `src/domain/notifications/notificationService.ts`,
  `src/domain/notifications/notificationRepository.port.ts`,
  `src/storage/repositories/sqliteNotificationRepository.ts`,
  `src/application/websocket/registry.ts`, `src/main.ts`, `docs/03-websocket-events.md`,
  `tests/support/fakeNotificationRepository.ts`. Testler: repository (2), unit (1), entegrasyon (1:
  seçili/tümü/yabancı id/idempotent/validasyon vakaları) + canlı sunucu üzerinden tarayıcıdan
  `notification.delete` round-trip doğrulandı. Kontroller: `deno task check` ✓, `deno task lint` ✓,
  `deno fmt --check` ✓, `deno task test` 3× (350 passed / 0 failed) ✓. Kalan adım: seçerek/tümünü
  silme arayüzü — mevcut chat istemcisinde bildirim listesi ekranı bulunmadığından bu arayüz,
  planlanan `Birleşik aktivite gelen kutusu` işiyle birlikte uygulanacak; o iş tamamlanmadan bu
  kayıt `Tamamlandı` yapılmamalıdır.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: `notification.delete` WS eventi
  (`{ ids }` veya `{ all: true }`), repository/servis silme metotları kullanıcı kapsamıyla
  (`user_id` filtresi başka kullanıcının bildirimini etkilemez), `docs/03` sözleşme güncellemesi,
  repository + unit + entegrasyon testleri. Not: mevcut chat istemcisinde bildirim listesi arayüzü
  bulunmadığından (yalnız konuşma başına unread rozetleri var) seçim arayüzü, planlanan
  `Birleşik aktivite gelen kutusu` işiyle birlikte gelecek.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Birleşik aktivite gelen kutusu

**Açıklama:** Mention, doğrudan mesaj, yanıt, reaksiyon, grup daveti ve sistem/güvenlik
bildirimlerinin tek bir aktivite gelen kutusunda gösterilmesi; kullanıcının `Tümü`, `Okunmamış`,
`Mention ve yanıtlar`, `Reaksiyonlar` ve `Davetler` gibi kararlı türlere göre filtreleyebilmesi.
Filtreler yalnız kullanıcının kendi bildirimlerini göstermeli ve bilinmeyen yeni türler güvenli bir
genel görünümle desteklenmelidir.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut notification list/mark-read altyapısının bulunduğu, ancak
  türlere ayrılmış birleşik aktivite gelen kutusu bulunmadığı doğrulanarak planlama listesine
  eklendi.

### Mesaj yanıtı bildirimleri

**Açıklama:** Bir kullanıcıya ait mesaja başka bir kullanıcı cevap verdiğinde kaynak mesaj sahibine
ayrı bir `reply` bildirimi oluşturulması; kişinin kendine cevabı, engellenmiş etkileşimler ve
konuşma bildirim tercihleri dikkate alınmalıdır. Yanıt aynı zamanda mention içeriyorsa aynı olay
için mükerrer bildirim üretilmemelidir.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut notification türlerinin `mention`, `dm`, `group_invite`
  ve `reaction` ile sınırlı olduğu; doğrudan reply bildirimi bulunmadığı doğrulanarak eklendi.

### Bildirimden hedef içeriğe güvenli geçiş

**Açıklama:** Bildirime basıldığında ilgili konuşmanın açılması, gerekiyorsa mesaj çevresinin
yüklenmesi ve hedef mesajın vurgulanması; ardından bildirimin okunmuş işaretlenmesi. Kullanıcı artık
konuşmaya erişemiyorsa, mesaj silinmişse veya hedef yoksa içerik sızdırmadan açıklayıcı fallback
gösterilmelidir. Bu iş mesaj kalıcı bağlantısı altyapısıyla ortak hedef çözümleme kullanmalıdır.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Notification DTO'sunda `conversationId` ve `messageId`
  bulunmasına rağmen tüm bildirim türleri için ortak, yetki kontrollü hedefe gitme akışı bulunmadığı
  doğrulanarak planlama listesine eklendi.

### Bildirim gruplama ve mükerrerleri birleştirme

**Açıklama:** Aynı mesajdaki kısa süreli reaksiyonlar, aynı konuşmadan gelen yoğun DM bildirimleri
ve aynı hedefe ait tekrar eden olayların tek bir özet bildirim altında gruplanması. Gruplama
sunucuda kararlı kimlik ve zaman penceresiyle yapılmalı; unread sayısı gerçek olay ve görünür grup
sayısı ayrımını doğru yönetmelidir.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Mevcut sistemin her notification olayını ayrı satır olarak
  oluşturduğu ve burst/dedup gruplaması bulunmadığı doğrulanarak planlama listesine eklendi.

### Bildirim sayfalama ve saklama politikası

**Açıklama:** Notification listesinin offset yerine kararlı cursor tabanlı sayfalama ile yüklenmesi
ve okunmuş/eski bildirimler için açık bir saklama politikası uygulanması. `notification.list` isteği
geriye uyumlu `unreadOnly` alanının yanında isteğe bağlı `types`, `cursor` ve `limit` almalıdır; ilk
sayfa varsayılan 50, izin verilen en yüksek sayfa 100 kayıt olmalıdır. Yanıt `notifications`,
`nextCursor` ve `hasMore` alanlarını döndürmelidir. Sıralama `created_at DESC, id DESC` olmalı;
opaque ve sürümlenebilir cursor bu iki değeri taşımalı, başka kullanıcının verisine erişim yetkisi
sağlamamalı ve malformed cursor standart `VALIDATION_ERROR` üretmelidir. Sayfalar arasında yeni
bildirim oluşması mevcut kayıtların atlanmasına veya tekrar gösterilmesine yol açmamalıdır.

İlk retention politikası okunmuş bildirimleri `read_at` üzerinden 90 gün saklamalı; okunmamış
bildirimler otomatik retention temizliğiyle silinmemelidir. Kullanıcının açıkça sildiği kayıtlar bu
süreden bağımsız kaldırılabilir. Temizlik, `NotificationCleanupJob` benzeri merkezi ve idempotent
bir iş tarafından ağ/WS gönderimi yapmadan, kısa transaction'lar ve sınırlı batch'ler halinde
çalıştırılmalıdır; servis yeniden başlatıldığında güvenle devam edebilmelidir. Şema değişikliği yeni
bir migration ile yapılmalı; mevcut bildirimler korunmalı ve kullanıcı + sıralama/cursor sorgusu ile
okunmuş retention taraması için uygun indeksler eklenmelidir.

İstemci ilk sayfayı açılışta yüklemeli, kullanıcı geçmişe indikçe `Daha fazla yükle` veya kontrollü
sonsuz kaydırma ile sonraki cursor'ı istemeli; yükleme sırasında mevcut kayıtları kaybetmemeli,
mükerrer kimlikleri birleştirmeli ve yeni `notification.new` push'larını listenin başına
eklemelidir. Filtre değişiminde cursor sıfırlanmalı; loading, listenin sonu, boş sonuç ve yeniden
deneme durumları ayrı gösterilmelidir. Repository ve entegrasyon testleri; kullanıcı izolasyonu,
limit sınırları, malformed cursor, eşit timestamp için `id` tie-break, sayfalar arasında eşzamanlı
insert, unread koruması, 90 günlük okunmuş temizliği, batch davranışı, migration upgrade yolu ve
indeksleri kapsamalıdır.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Kapsam; `(created_at, id)` cursor sözleşmesi,
  varsayılan/maksimum sayfa boyutu, 90 günlük okunmuş retention, unread koruması, batch cleanup job,
  gerekli indeksler, istemci birleştirme davranışı ve yarış/migration test kabul ölçütleriyle
  ayrıntılandırıldı. Migration, repository, domain, protocol, lifecycle job, istemci ve test
  katmanlarının birlikte değişmesi gerektiği netleştiği için efor `Orta` seviyesinden `Yüksek`
  seviyesine çıkarıldı.
- 2026-07-14 — Model: GPT-5 Codex — `notification.list` çağrısının kullanıcıya ait sonuçları tek
  seferde döndürdüğü, cursor/limit ve kalıcı retention politikası bulunmadığı doğrulanarak eklendi.

### Konuşmalar arası okunmamış navigasyonu

**Açıklama:** Kullanıcının sıradaki veya önceki okunmamış kanal, grup ya da DM'e tek eylemle
geçebilmesi; konuşma açıldığında ilk okunmamış mesaja atlama işiyle birlikte çalışması. Sıralama
favori/kişisel konuşma düzenini gözetmeli, sessize alınmış konuşmalar için davranış açıkça
belirlenmeli ve klavye kısayollarına bağlanabilmelidir.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Konuşma badge'leri mevcut ve konuşma içi ilk unread işi planlı;
  farklı konuşmalar arasında sonraki/önceki unread navigasyonu bulunmadığı doğrulanarak planlama
  listesine eklendi.

## Güvenlik ve hesaplar

### Güvenli gerçek istemci IP aktarımı

**Açıklama:** Caddy arkasında çalışan uygulamanın bütün HTTP ve WebSocket istemcilerini `127.0.0.1`
olarak görmesi düzeltilmelidir. Caddy, Cloudflare'dan gelen gerçek istemci IP bilgisini doğrulanmış
bir proxy zinciri üzerinden uygulamaya aktarmalı; uygulama forwarded IP header'larını yalnızca
doğrudan socket peer'i açıkça güvenilen loopback veya yapılandırılmış proxy olduğunda kabul
etmelidir. Güvenilmeyen doğrudan isteklerde ve sahte header'larda socket IP'si kullanılmaya devam
edilmelidir. Kayıt, giriş, token yenileme ve parola kurtarma gibi IP tabanlı HTTP rate-limit
anahtarları ile WebSocket IP bağlantı kotası gerçek istemci IP'sine göre çalışmalıdır. Çözüm;
Cloudflare/Caddy güven sınırını, IPv4 ve IPv6 davranışını, malformed ve çoklu forwarded header
durumlarını, spoofing testlerini, production Caddy yapılandırmasını, ortam değişkenlerini,
dokümantasyonu ve dağıtım sonrası doğrulamayı kapsamalıdır. Forwarded header'lara koşulsuz güven
eklenmemelidir.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: GPT-5 Codex — Uygulama ve production dağıtımı tamamlandı.
  - `9ea9860` commit'i `origin/main` dalına push edildi ve `/opt/centrum-chat` üzerinde
    `git pull --ff-only` ile dağıtıldı.
  - Malformed bracket'lı IPv6 ve geçersiz port ekleri artık socket IP'ye güvenli biçimde düşüyor;
    `[2001:db8::1]garbage`, `[2001:db8::1]:99999` ve `198.51.100.7:99999` regresyon vakaları
    eklendi.
  - Kontroller: `deno task check`, `deno task lint`, `deno fmt --check` ve tam test paketi
    (`337 passed / 0 failed`) başarılı.
  - Production ortamına `TRUSTED_PROXY_IPS=127.0.0.1,::1` eklendi. Caddy'ye güncel Cloudflare
    IPv4/IPv6 aralıkları, `trusted_proxies_strict`, `client_ip_headers CF-Connecting-IP` ve
    uygulamaya yalnızca tasdikli `{client_ip}` değerini ileten `header_up X-Forwarded-For`
    yapılandırması mevcut global/site yapısı korunarak eklendi.
  - Yedekler: `/etc/caddy/Caddyfile.bak-client-ip-20260714` ve
    `/etc/centrum-chat/centrum-chat.env.bak-client-ip-20260714`. Caddy doğrulaması başarılı;
    `centrum-chat` ve `caddy` servisleri aktif, readiness başarılı.
  - Dağıtım sonrası doğrulamada Cloudflare üzerinden gelen canlı WebSocket gerçek istemci IP'siyle
    kaydedildi; doğrudan Caddy'ye sahte `CF-Connecting-IP` ve `X-Forwarded-For` gönderildiğinde
    uygulama sahte değeri değil socket peer olan `127.0.0.1` değerini kullandı.

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Uygulama tarafı tamamlandı; yalnızca production
  Caddy yapılandırması ve dağıtım sonrası doğrulama kaldığı için durum `Devam ediyor` bırakıldı.
  - Değiştirilen/eklenen dosyalar: `src/shared/security/clientIp.ts` (yeni merkezi trusted-proxy /
    client-IP politikası: IPv4+IPv6 ayrıştırma, CIDR eşleme, sağdan-sola zincir çözümleme, RFC 5952
    kanonik çıktı, IPv4-mapped IPv6 normalizasyonu), `src/shared/config/config.ts`
    (`TRUSTED_PROXY_IPS` — boot'ta doğrulanır, hatalı girdi süreci durdurur),
    `src/transport/http/httpServer.ts` (IP'nin türetildiği tek nokta artık politikadan geçiyor; HTTP
    route'ları, rate-limit anahtarları ve WS upgrade aynı çözümlenmiş değeri alıyor), `src/main.ts`
    (bağlama + `server started` logunda `trustedProxyIps`), `.env.example`, `README.md`, `AGENTS.md`
    §10, `docs/09-public-internet-security.md`.
  - Güven modeli: forwarded header yalnızca doğrudan socket peer `TRUSTED_PROXY_IPS` içindeyken ve
    yalnızca `X-Forwarded-For` üzerinden dikkate alınır; zincir sağdan sola yürünür, güvenilen
    proxy'ler atlanır, ilk güvenilmeyen giriş istemcidir. Malformed/boş öğe veya tamamı-güvenilen
    zincir socket IP'ye düşer. `CF-Connecting-IP`, `X-Real-IP`, `Forwarded`, `Host`, `Origin` asla
    IP otoritesi değildir. `TRUSTED_PROXY_IPS` boşken davranış birebir eskisi gibidir (socket peer).
    Kod içinde raw SQL yok; yeni harici bağımlılık yok; katman yönü korunmuştur.
  - Testler: `tests/unit/clientIp.test.ts` (14 test: spoofed XFF/CF-Connecting-IP, güvenilir
    loopback + gerçek IP, IPv6 + kanonikleştirme, IPv4-mapped, malformed/boş header, çok elemanlı
    zincir iki güven modeliyle, port stripping, CIDR, hatalı config fail-fast) ve
    `tests/integration/clientIpTrust.test.ts` (4 test: login rate-limit bucket'ının çözümlenmiş
    IP'yle ayrıştığı, sahte header ile bucket/kota kaçışının mümkün olmadığı, WS per-IP kotasının
    çözümlenmiş IP'yle çalıştığı — ham WS el sıkışmasıyla `X-Forwarded-For` enjekte edilerek).
  - Kontroller: `deno task check` ✓, `deno task lint` ✓, `deno fmt --check` ✓, `deno task test` art
    arda 3 kez ✓ (337 passed / 0 failed).
  - Kalan dağıtım adımları (repo dışı, uygulanmadı): (1) `/etc/centrum-chat/centrum-chat.env`
    dosyasına `TRUSTED_PROXY_IPS=127.0.0.1,::1` eklenmesi ve servisin yeniden başlatılması; (2)
    Caddy'ye global
    `servers { trusted_proxies static <Cloudflare IPv4+IPv6 aralıkları>;
    client_ip_headers CF-Connecting-IP }`
    ve site bloğuna `reverse_proxy 127.0.0.1:8047 {
    header_up X-Forwarded-For {client_ip} }`
    yapılandırması (önce Caddyfile yedeği + `caddy
    validate`, sonra reload); (3) dağıtım sonrası
    doğrulama: uygulama loglarında `clientIp` alanının gerçek istemci IP'leri göstermesi, dışarıdan
    sahte `X-Forwarded-For`/ `CF-Connecting-IP` ile yapılan isteklerin sahte değeri ASLA
    yansıtmaması.
  - Risk notu: Caddy'de Cloudflare aralıkları `trusted_proxies`'e eklenmeden app-side ayar tek
    başına yeterli değildir (Caddy zinciri değiştirirse istemci yerine CF edge IP'si çözülür);
    Cloudflare IP listesi zamanla değişebilir, dağıtımda güncel liste kullanılmalıdır.
- 2026-07-13 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: merkezi bir trusted-proxy /
  client-IP çözümleme modülü (`src/shared/security/` altında), `TRUSTED_PROXY_IPS` yapılandırması
  (`config.ts` + `.env.example`), `httpServer.ts` ve WS upgrade akışının aynı çözümlenmiş IP'yi
  kullanması, spoofing/IPv6/malformed/çoklu-zincir birim testleri ve rate-limit ile WS IP kotası
  doğrulama testleri. Production Caddy yapılandırması repo dışında; uygulanacak exact yapılandırma
  raporlanacak, sunucuya dokunulmayacak.
- 2026-07-13 — Model: GPT-5 Codex — Üretimde Caddy üzerinden gelen bütün isteklerin uygulama
  günlüklerinde `clientIp: 127.0.0.1` olduğu doğrulandı. Bu nedenle IP tabanlı kimlik doğrulama
  limitleri bütün site tarafından ortak kullanılıyor ve `WS_MAX_CONNECTIONS_PER_IP=25` değeri fiilen
  site genelinde toplam 25 bağlantı sınırına dönüşüyor. Güvenli trusted-proxy tasarımı ve spoofing
  testleri henüz uygulanmadı.

### TOTP iki aşamalı doğrulama

**Açıklama:** Kullanıcının yerel olarak üretilen TOTP sırrını etkinleştirebilmesi; girişte parola
sonrasında tek kullanımlık kod doğrulaması ve güvenli kapatma akışı eklenmesi.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Yedek kurtarma kodları

**Açıklama:** İki aşamalı doğrulama için tek kullanımlık kurtarma kodlarının üretilmesi, yalnızca
hash'lerinin saklanması ve kullanım sonrası tüketilmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Şüpheli oturum bildirimleri

**Açıklama:** Yeni veya belirgin biçimde farklı bir oturum algılandığında kullanıcıya uygulama içi
güvenlik bildirimi oluşturulması ve ilgili oturumu hızlıca iptal etme bağlantısı sunulması.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Oturum IP ve istemci geçmişi

**Açıklama:** Hesap güvenliği ekranında oturumların IP adresi, cihaz etiketi, user-agent özeti, son
kullanım zamanı ve iptal durumunun gösterilmesi; harici konum servisi kullanılmaması.

**Öncelik:** Yüksek

**Efor:** Düşük

#### Durum

`Tamamlandı`

- 2026-07-14 — Model: Fable 5 (claude-fable-5) — Tamamlandı. `0010_session_client_metadata`
  migration'ı `user_sessions` tablosuna nullable `ip_address` ve `user_agent` ekledi (eski oturumlar
  null ile geçerli kalıyor; taze + legacy upgrade yolu `db.test.ts` ile ve
  `PRAGMA
  foreign_key_check`/`integrity_check` ile doğrulandı). IP, register/login/refresh
  route'larında merkezi trusted-proxy politikasıyla çözülmüş `ctx.clientIp` değerinden geliyor —
  istemci header'ından asla; `User-Agent` kontrol karakterleri temizlenip 400 karakterle
  sınırlanıyor (`sanitizeUserAgent`). Refresh rotasyonu metadata'yı güncelliyor (verilmezse
  `COALESCE` ile eskisi korunuyor). Sözleşme değişikliği: `GET /api/auth/sessions` artık süresi
  dolmamış iptal edilmiş oturumları da `revokedAt` ile geçmiş olarak listeliyor (aktifler önce;
  temizlik işi eski iptalleri süpürünce geçmiş doğal olarak sınırlı) — `docs/04` güncellendi; port
  metodu `listActiveForUser` → `listForUser`. Arayüz: oturum kartlarında IP, kısaltılmış istemci
  özeti, `Revoked` rozeti; iptal edilmişlerde Revoke butonu yok; harici konum servisi yok. Dosyalar:
  `db/migrations/0010_session_client_metadata.sql`, `userSessionRepository.port.ts`,
  `sqliteUserSessionRepository.ts`, `authService.ts`, `emailAddress.ts`,
  `accountSecurity.entity.ts`, `loginRoute.ts`, `registerRoute.ts`, `refreshRoute.ts`,
  `docs/04-http-api.md`, `web/index.html`, `web/scripts/chat-handlers.js`. Testler: unit (metadata
  yakalama/sanitizasyon/refresh güncellemesi), repository (roundtrip, `COALESCE`, `listForUser`
  sıralaması), entegrasyon (login header'ından yakalama, refresh güncellemesi, iptal geçmişi),
  `tests/unit/frontendSessionHistory.static.test.ts` + gerçek tarayıcıda canlı sunucudan
  IP/user-agent doğrulaması. Kontroller: `deno task check` ✓, `deno task lint` ✓, `deno fmt --check`
  ✓, `deno task test` 3× (368 passed / 0 failed) ✓.
- 2026-07-14 — Model: Fable 5 (claude-fable-5) — İşe başlandı. Plan: `0010_session_client_metadata`
  migration'ı ile `user_sessions` tablosuna nullable `ip_address` ve `user_agent`; login/register'da
  merkezi politikayla çözülmüş `clientIp` + sınırlandırılmış `User-Agent` kaydı, refresh
  rotasyonunda güncelleme; oturum listesinin süresi dolmamış iptal edilmiş oturumları `revokedAt`
  ile birlikte "geçmiş" olarak içermesi (sözleşme değişikliği `docs/04` ile birlikte); arayüzde IP,
  istemci özeti ve `Revoked` rozeti; harici konum servisi yok.
- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Dosya ve medya

### Görsel thumbnail üretimi

**Açıklama:** Yüklenen raster görseller için boyut sınırları uygulanarak küçük önizlemeler
üretilmesi; orijinal ve thumbnail yaşam döngüsünün birlikte yönetilmesi.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Güvenli medya önizlemesi

**Açıklama:** Desteklenen görsel ve video eklerinin erişim kontrolü korunarak sohbet içinde
önizlenmesi; desteklenmeyen türlerin indirme olarak kalması.

**Öncelik:** Orta

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Depolama kotası

**Açıklama:** Kullanıcı ve gerektiğinde konuşma bazında toplam dosya kullanımının izlenmesi;
ayarlanabilir kotanın aşılması halinde yeni yüklemelerin reddedilmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Kalıcı orphan dosya temizliği

**Açıklama:** Process içindeki mevcut zamanlayıcı yerine, yeniden başlatmalardan etkilenmeyen kalıcı
iş kaydıyla bağlanmamış ve süresi dolmuş dosyaların güvenli biçimde temizlenmesi.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## Operasyon ve dayanıklılık

### Veritabanı yedekleme ve geri yükleme

**Açıklama:** SQLite WAL durumu gözetilerek tutarlı yedek alınması, saklama politikası uygulanması
ve geri yükleme adımlarının doğrulanabilir yönetim scriptleriyle sunulması.

**Öncelik:** Yüksek

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Kalıcı görev zamanlayıcısı

**Açıklama:** Zamanlanmış mesaj, dosya temizliği ve benzeri işler için SQLite üzerinde tek sunucuya
uygun kalıcı görev kuyruğu ve kontrollü tekrar deneme mekanizması oluşturulması.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

## İstemci ve protokol

### Ortak auth.html kimlik doğrulama sayfası

**Açıklama:** `web/auth.html` altında chat ve Control Center tarafından ortak kullanılan ayrı bir
kimlik doğrulama sayfası oluşturulmalıdır. Kayıt, giriş, parola sıfırlama, e-posta doğrulama ve
desteklenen diğer auth/hesap kurtarma akışları bu sayfada merkezi olarak yönetilmeli; ana chat ve
Control Center içinde yinelenen auth arayüzleri kaldırılmalı veya bu sayfaya yönlendirilmelidir.
Chat ya da Control Center açıldığında geçerli access token yoksa önce mevcut refresh oturumu güvenli
biçimde denenmeli, oturum geri yüklenemezse kullanıcı `auth.html` sayfasına yönlendirilmelidir.
Başarılı kimlik doğrulama sonrasında kullanıcı yalnızca aynı origin içindeki doğrulanmış başlangıç
hedefine geri gönderilmelidir; kullanıcı kontrollü `returnTo` değeri açık yönlendirme oluşturamaz.
Doğrudan `auth.html` sayfasını açan oturum sahibi kullanıcı uygun varsayılan hedefe yönlendirilmeli,
redirect döngüleri önlenmeli ve auth kontrolü sırasında korumalı arayüz içeriği kısa süreliğine dahi
gösterilmemelidir. Geçerli oturumu olup Control Center yetkisi olmayan kullanıcı auth sayfasına geri
gönderilmemeli; ayrı bir permission-denied davranışı uygulanmalıdır. Yeni `auth.html`, script, stil
ve i18n katalogları statik route allow-list'i, CSP, token saklama politikası, güvenlik linkleri,
erişilebilirlik ve hem chat hem Control Center yönlendirme testleriyle birlikte ele alınmalıdır.
Yeni kayıtlar, aşağıdaki adım adım kayıt ve onboarding akışı tamamlanmadan chat'e geçirilmemelidir.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Kayıt adımlarının sırası netleştirildi: bilgiler → preferences →
  yalnızca zorunluysa e-posta doğrulama. Önceki nottaki e-posta doğrulama → preferences sırası bu
  kararla geçersizdir.
- 2026-07-13 — Model: GPT-5 Codex — `auth.html` kapsamına dinamik kayıt ve onboarding adımları
  bağlandı. Yeni kullanıcı, gerekiyorsa e-posta doğrulamasını ve ardından tercih kurulumunu
  tamamladıktan sonra hedef uygulamaya yönlendirilecek.
- 2026-07-13 — Model: GPT-5 Codex — Auth arayüzünün `auth.html` altında merkezileştirilmesine karar
  verildi. Chat ve Control Center geçerli oturum yoksa bu sayfaya yönlenecek; güvenli `returnTo`,
  refresh denemesi, yetki hatası ayrımı ve redirect döngüsü korumaları henüz uygulanmadı.

### Adım adım kayıt ve onboarding

**Açıklama:** Yeni hesap oluşturma akışı `auth.html` içinde yenileme ve tekrar giriş durumlarına
dayanıklı adımlarla ilerlemelidir. Birinci adım kullanıcı adı, e-posta, parola ve temel profil
bilgileriyle hesabı oluşturmalıdır. İkinci adım her kullanıcı için preferences kurulumu olmalı;
`dmPrivacy` için herkes, ortak grup üyeleri veya hiç kimse; `groupPrivacy` için herkes, DM kişileri
veya hiç kimse seçenekleri anlaşılır metinlerle sorulmalıdır. Kullanıcı ayrıca güvenli `#RRGGBB`
değerlerinden sohbet/ad rengi (`nameColor`), bio, hazır avatar (`avatarSeed`), hazır kapak
(`coverIndex`), tema, ses ve masaüstü bildirim tercihlerini belirleyebilmelidir. Bu adımda özel
avatar veya kapak dosyası yükleme bulunmamalıdır. Özel medya yüklemeleri onboarding tamamlandıktan
ve `email_verification_required` etkinse e-posta doğrulandıktan sonra profil ekranından
yapılmalıdır. Tarayıcı bildirim izni yalnızca kullanıcının açık etkileşimiyle istenmelidir.
Preferences kaydedildikten sonra `email_verification_required` çalışma zamanı ayarı etkinse üçüncü
adım olarak auth ekranının e-posta doğrulama sekmesi açılmalı; kullanıcıya hangi adresi doğrulaması
gerektiği, bağlantının süresi ve yeniden gönderme işlemi gösterilmelidir. Hesap gerçekten
doğrulanmadan bu adım tamamlanmış sayılmamalıdır. Ayar kapalıysa üçüncü adım hiç gösterilmemeli ve
onboarding ikinci adımın başarıyla kaydedilmesiyle tamamlanmalıdır. Seçimler mevcut
`preferences.update` ve `profile.update` kurallarıyla veya aynı domain servislerini kullanan özel
bir onboarding uygulama akışıyla sunucuda doğrulanıp kalıcı hale getirilmelidir. Onboarding
tamamlanma durumu sunucuda tutulmalı; sayfa yenileme, token refresh veya tekrar girişte kullanıcı
eksik kalan adımdan devam etmelidir. Eski kullanıcılar migration sırasında tamamlanmış kabul
edilmeli; doğrudan URL ile chat'e gitmek zorunlu adımları atlatmamalı; buna karşılık auth, hesap
güvenliği ve onboarding işlemleri tamamlanmamış kullanıcı için erişilebilir kalmalıdır. Adımların
sırası, ilerleme göstergesi, geri dönüş davranışı, hata kodları, i18n anahtarları, erişilebilirlik
ve `email_verification_required` açık/kapalı entegrasyon testleri birlikte uygulanmalıdır.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-14 — Model: GPT-5 Codex — Onboarding preferences adımından özel avatar ve kapak dosyası
  yükleme çıkarıldı. Bu adımda yalnızca bio, `avatarSeed`, `coverIndex`, `nameColor` ve mevcut
  preferences alanları düzenlenecek; özel medya yükleme daha sonra profil ekranından yapılacak.
- 2026-07-13 — Model: GPT-5 Codex — Adım sırası kullanıcı kararıyla güncellendi: adım 1 hesap
  bilgileri, adım 2 preferences, adım 3 yalnızca `email_verification_required` açıksa e-posta
  doğrulama. Önceki durum notundaki doğrulama → preferences sırası artık geçerli değildir.
- 2026-07-13 — Model: GPT-5 Codex — Kayıt akışı dinamik olarak kararlaştırıldı: hesap oluşturma →
  `email_verification_required` açıksa e-posta doğrulama → gizlilik ve görünüm tercihleri → chat
  veya güvenli dönüş hedefi. DM izni, grup daveti izni ve sohbet/ad rengi zorunlu onboarding
  seçimleri olacak; sunucu taraflı ilerleme ve devam etme mekanizması henüz uygulanmadı.

### Merkezi i18n sistemi

**Açıklama:** Ana chat istemcisi ile Control Center için ortak kurallara sahip merkezi bir i18n
sistemi oluşturulmalıdır. Dil katalogları, locale seçimi, varsayılan dil, eksik anahtar fallback'i
ve kullanıcının dil tercihinin saklanması tek bir yapıdan yönetilmelidir. Ortak `auth.html` sayfası
bu sistemin birincil auth arayüzü olmalıdır. Kayıt, giriş, çıkış, token yenileme, e-posta doğrulama,
parola değiştirme ve sıfırlama, e-posta değiştirme, oturum listeleme ve iptal etme gibi auth/hesap
güvenliği işlemlerinin başlıkları, açıklamaları, form alanları, doğrulama mesajları, başarı
bildirimleri ve hata metinleri hem chat hem de Control Center tarafında bu kataloglardan
alınmalıdır. Backend kararlı hata kodları üretmeye devam etmeli; kullanıcıya gösterilen
yerelleştirilmiş karşılık istemcide merkezi hata-kodu eşlemesiyle seçilmelidir. Yetkilendirme
backend politikalarında kalmalı ve çeviri sistemi hiçbir güvenlik kararının kaynağı olmamalıdır.
Yeni locale ve katalog dosyaları eklenirken Control Center statik dosya allow-list'i, CSP sınırları,
HTML dil özellikleri, tarih/saat ve çoğul ifade biçimlendirmesi, erişilebilirlik metinleri ve her
iki istemcinin statik testleri birlikte güncellenmelidir.

**Öncelik:** Yüksek

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Adım adım kayıt, koşullu e-posta doğrulama ve tercih onboarding
  ekranlarının tüm başlık, açıklama, seçenek, doğrulama ve hata metinleri merkezi i18n kapsamına
  eklendi.
- 2026-07-13 — Model: GPT-5 Codex — Auth arayüzünün ayrı `auth.html` sayfasında merkezileştirilmesi
  kararı i18n kapsamına işlendi; auth sayfası ile chat ve Control Center aynı katalogları
  kullanacak.
- 2026-07-13 — Model: GPT-5 Codex — Merkezi i18n ihtiyacı planlama listesine eklendi. Auth ve hesap
  güvenliği akışlarının chat ile Control Center'daki kullanıcı metinleri ortak kataloglardan
  yönetilecek; katalog biçimi, desteklenecek ilk diller ve locale fallback zinciri henüz
  belirlenmedi.

### Kişisel API tokenları

**Açıklama:** Kullanıcıların sınırlı yetkili, isimlendirilmiş, son kullanma tarihli ve iptal
edilebilir API tokenları oluşturabilmesi; yalnızca token hash'lerinin saklanması.

**Öncelik:** Düşük

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### PWA desteği

**Açıklama:** Mevcut web istemcisinin kurulabilir manifest, güvenli service worker ve temel
çevrimdışı uygulama kabuğuyla PWA olarak kullanılabilmesi; mesaj verilerinin çevrimdışı cache'e
yazılmaması.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Binary protokol codec'i

**Açıklama:** Mevcut `ProtocolCodec` seam'i üzerinden JSON protokolüne alternatif bir `EnfCodec`
uygulanması; aynı handler ve domain katmanlarının codec'ten bağımsız kalması.

**Öncelik:** Düşük

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.
