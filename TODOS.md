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

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Zamanlanmış mesajlar

**Açıklama:** Kullanıcının mesaj için gelecekte bir gönderim zamanı belirleyebilmesi; zamanlanan
mesajların kalıcı olarak saklanması, iptal edilebilmesi ve sunucu yeniden başlasa da gönderilmesi.

**Öncelik:** Düşük

**Efor:** Yüksek

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

### Markdown ve kod bloğu desteği

**Açıklama:** Mesajlarda güvenli bir Markdown alt kümesinin, satır içi kodun ve kod bloklarının XSS
oluşturmadan görüntülenmesi.

**Öncelik:** Orta

**Efor:** Orta

#### Durum

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

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

`Bekliyor`

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

`Bekliyor`

- 2026-07-13 — Model: GPT-5 Codex — Planlama listesine eklendi; henüz başlanmadı.

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

`Bekliyor`

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
