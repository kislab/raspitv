// Widevine-Zwischenstecker für RaspiTV
//
// Chromium lässt DRM-geschützte Videos (Netflix, Disney+ …) vom Widevine-Modul entschlüsseln UND
// dekodieren – in Software. Auf dem Raspberry Pi 4 kostet das viel CPU, obwohl der Video-Chip
// (bcm2835-codec, /dev/video10) H.264 dekodieren kann und Chromium ihn für normale Videos auch nutzt.
//
// Dieser Zwischenstecker gibt sich gegenüber Chromium als Widevine aus, lädt das echte Widevine
// (libwidevinecdm.real.so im selben Ordner) und reicht alle Aufrufe unverändert durch – nur
// InitializeVideoDecoder() meldet "nicht unterstützt". Chromium lässt Videos dann von Widevine nur
// entschlüsseln und dekodiert sie selbst, mit dem Hardware-Dekoder.
//
// Bauen:  g++ -O2 -shared -fPIC -std=c++17 -o libwidevinecdm.so shim.cc -ldl

#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <unistd.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CDM_IMPLEMENTATION
#include "content_decryption_module.h"

namespace {

void* g_real = nullptr;  // Handle des echten Widevine
int g_log = -1;          // Protokoll – vor der Sandbox geöffnet, danach nur noch beschrieben

void Log(const char* fmt, ...) {
  if (g_log < 0) return;
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
  va_end(ap);
  if (n > 0) {
    buf[n < (int)sizeof(buf) - 1 ? n : (int)sizeof(buf) - 2] = '\n';
    if (write(g_log, buf, (n < (int)sizeof(buf) - 1 ? n : (int)sizeof(buf) - 2) + 1) < 0) {}
  }
}

using InitFn = void (*)();
using DeinitFn = void (*)();
using CreateFn = void* (*)(int, const char*, uint32_t, GetCdmHostFunc, void*);
using VersionFn = const char* (*)();
using VerifyFn = bool (*)(const void*, uint32_t);

template <typename T>
T Real(const char* name) {
  return g_real ? reinterpret_cast<T>(dlsym(g_real, name)) : nullptr;
}

bool Enabled() {
  // Zum Vergleichen abschaltbar: RASPITV_CDM_DECODE=1 lässt Widevine wieder selbst dekodieren.
  const char* v = getenv("RASPITV_CDM_DECODE");
  return !(v && v[0] == '1');
}

// Wird beim Laden ausgeführt – vor der Sandbox, daher darf hier noch eine Datei geöffnet werden.
__attribute__((constructor)) void LoadReal() {
  if (const char* log = getenv("RASPITV_CDM_LOG")) g_log = open(log, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  Log("geladen (pid %d)", (int)getpid());
  Dl_info info;
  if (!dladdr(reinterpret_cast<void*>(&LoadReal), &info) || !info.dli_fname) return;
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "%s", info.dli_fname);
  char* slash = strrchr(path, '/');
  if (!slash) return;
  snprintf(slash + 1, sizeof(path) - (slash + 1 - path), "libwidevinecdm.real.so");
  g_real = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (!g_real) Log("echtes Widevine nicht ladbar: %s", dlerror());
}

// Reicht alles an das echte Widevine weiter; nur das Video-Dekodieren wird abgelehnt.
// Für die Schnittstellen 10 und 11 (gleiche Methoden), Chromium nutzt derzeit 11.
template <typename CDM>
class Proxy final : public CDM {
 public:
  explicit Proxy(CDM* real) : real_(real) {}

  void Initialize(bool a, bool b, bool c) override { real_->Initialize(a, b, c); }
  void GetStatusForPolicy(uint32_t id, const cdm::Policy& p) override { real_->GetStatusForPolicy(id, p); }
  void SetServerCertificate(uint32_t id, const uint8_t* d, uint32_t n) override { real_->SetServerCertificate(id, d, n); }
  void CreateSessionAndGenerateRequest(uint32_t id, cdm::SessionType t, cdm::InitDataType it,
                                       const uint8_t* d, uint32_t n) override {
    real_->CreateSessionAndGenerateRequest(id, t, it, d, n);
  }
  void LoadSession(uint32_t id, cdm::SessionType t, const char* s, uint32_t n) override { real_->LoadSession(id, t, s, n); }
  void UpdateSession(uint32_t id, const char* s, uint32_t sn, const uint8_t* r, uint32_t rn) override {
    real_->UpdateSession(id, s, sn, r, rn);
  }
  void CloseSession(uint32_t id, const char* s, uint32_t n) override { real_->CloseSession(id, s, n); }
  void RemoveSession(uint32_t id, const char* s, uint32_t n) override { real_->RemoveSession(id, s, n); }
  void TimerExpired(void* context) override { real_->TimerExpired(context); }
  cdm::Status Decrypt(const cdm::InputBuffer_2& in, cdm::DecryptedBlock* out) override {
    cdm::Status s = real_->Decrypt(in, out);
    if ((++decrypts_ % 500) == 1) Log("Decrypt #%u -> Status %d", decrypts_, (int)s);
    return s;
  }
  cdm::Status InitializeAudioDecoder(const cdm::AudioDecoderConfig_2& c) override { return real_->InitializeAudioDecoder(c); }

  cdm::Status InitializeVideoDecoder(const cdm::VideoDecoderConfig_2& c) override {
    if (Enabled()) {
      Log("Video-Dekodierung abgelehnt (Codec %d, %dx%d) -> Chromium dekodiert selbst",
          static_cast<int>(c.codec), c.coded_size.width, c.coded_size.height);
      return cdm::kInitializationError;
    }
    return real_->InitializeVideoDecoder(c);
  }

  void DeinitializeDecoder(cdm::StreamType t) override { real_->DeinitializeDecoder(t); }
  void ResetDecoder(cdm::StreamType t) override { real_->ResetDecoder(t); }
  cdm::Status DecryptAndDecodeFrame(const cdm::InputBuffer_2& in, cdm::VideoFrame* f) override {
    if ((++frames_ % 500) == 1) Log("DecryptAndDecodeFrame #%u", frames_);
    return real_->DecryptAndDecodeFrame(in, f);
  }
  cdm::Status DecryptAndDecodeSamples(const cdm::InputBuffer_2& in, cdm::AudioFrames* f) override {
    return real_->DecryptAndDecodeSamples(in, f);
  }
  void OnPlatformChallengeResponse(const cdm::PlatformChallengeResponse& r) override { real_->OnPlatformChallengeResponse(r); }
  void OnQueryOutputProtectionStatus(cdm::QueryResult r, uint32_t link, uint32_t prot) override {
    real_->OnQueryOutputProtectionStatus(r, link, prot);
  }
  void OnStorageId(uint32_t v, const uint8_t* id, uint32_t n) override { real_->OnStorageId(v, id, n); }

  void Destroy() override {
    real_->Destroy();
    delete this;
  }

 private:
  ~Proxy() override = default;
  CDM* real_;
  unsigned decrypts_ = 0, frames_ = 0;
};

}  // namespace

extern "C" {

CDM_API void INITIALIZE_CDM_MODULE() {
  if (auto f = Real<InitFn>("InitializeCdmModule_4")) f();
}

CDM_API void DeinitializeCdmModule() {
  if (auto f = Real<DeinitFn>("DeinitializeCdmModule")) f();
}

CDM_API void* CreateCdmInstance(int version, const char* key_system, uint32_t key_system_size,
                                GetCdmHostFunc get_host, void* user_data) {
  auto create = Real<CreateFn>("CreateCdmInstance");
  if (!create) return nullptr;
  void* cdm = create(version, key_system, key_system_size, get_host, user_data);
  Log("CreateCdmInstance(Version %d) -> %p", version, cdm);
  if (!cdm) return cdm;
  if (version == cdm::ContentDecryptionModule_10::kVersion)
    return new Proxy<cdm::ContentDecryptionModule_10>(static_cast<cdm::ContentDecryptionModule_10*>(cdm));
  if (version == cdm::ContentDecryptionModule_11::kVersion)
    return new Proxy<cdm::ContentDecryptionModule_11>(static_cast<cdm::ContentDecryptionModule_11*>(cdm));
  Log("unbekannte Schnittstellenversion %d - unverändert durchgereicht", version);
  return cdm;
}

CDM_API const char* GetCdmVersion() {
  auto f = Real<VersionFn>("GetCdmVersion");
  return f ? f() : "0";
}

CDM_API bool VerifyCdmHost_0(const void* files, uint32_t count) {
  auto f = Real<VerifyFn>("VerifyCdmHost_0");
  return f ? f(files, count) : true;
}

}  // extern "C"
