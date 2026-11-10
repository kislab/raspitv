# Widevine-Zwischenstecker (Versuch, nicht im Einsatz)

Ziel: Netflix auf dem Raspberry Pi 4 mit dem Hardware-Video-Dekoder (`/dev/video10`) abspielen
statt in Software.

## Idee

Chromium lässt DRM-Videos vom Widevine-Modul entschlüsseln **und** dekodieren (Software).
`shim.cc` gibt sich als Widevine aus, reicht alles an das echte Modul weiter und lehnt nur
`InitializeVideoDecoder()` ab. Chromium lässt dann nur entschlüsseln und dekodiert selbst –
mit dem Video-Chip.

Bauen: `g++ -O2 -shared -fPIC -std=c++17 -fvisibility=hidden -o libwidevinecdm.so shim.cc -ldl`
Einbinden: Ordner mit `manifest.json`, `_platform_specific/linux_arm64/libwidevinecdm.so` (Zwischenstecker)
und `libwidevinecdm.real.so` (echtes Modul) anlegen und
`<Player-Profil>/WidevineCdm/latest-component-updated-widevine-cdm` darauf zeigen lassen.
Chromium nutzt CDM-Schnittstelle 11.

## Ergebnis (2026-11-10)

- Der Video-Chip wird genutzt, Chromium-Last sinkt von ~115 % auf ~82 % CPU.
- **Aber:** Netflix liefert nur die ersten ~2 Minuten jeder Folge unverschlüsselt aus. Danach gibt
  Widevine für reines Entschlüsseln keinen Schlüssel heraus (`Decrypt` → `kNoKey`), die Wiedergabe
  bleibt stehen. Netflix-Lizenzen erlauben Video nur mit Dekodierung im Widevine-Modul
  (`SW_SECURE_DECODE`); eine abgeänderte Anforderung (`SW_SECURE_CRYPTO`) ändert daran nichts.

Damit ist Hardware-Dekodierung für Netflix mit Widevine L3 nicht möglich. Der Zwischenstecker ist
daher **nicht eingebunden**.
