/*
 * ███████╗███╗   ███╗██╗███╗   ██╗███████╗███╗   ██╗ ██████╗███████╗
 * ██╔════╝████╗ ████║██║████╗  ██║██╔════╝████╗  ██║██╔════╝██╔════╝
 * █████╗  ██╔████╔██║██║██╔██╗ ██║█████╗  ██╔██╗ ██║██║     █████╗
 * ██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██║╚██╗██║██║     ██╔══╝
 * ███████╗██║ ╚═╝ ██║██║██║ ╚████║███████╗██║ ╚████║╚██████╗███████╗
 * ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
 *
 * Eminence Tweak  —  Gaming PC Optimizer v3.0
 * Dark Glassmorphism  |  Violet accent  |  Ultra-clean UI
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <tchar.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <vector>
#include <string>
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <ctime>
#include <cmath>

#ifndef IM_PI
#define IM_PI 3.14159265358979323846f
#endif

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")

#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"
#include "tweaks.h"

// ─── D3D11 globals ────────────────────────────────────────────────────────
static ID3D11Device*           g_pd3dDevice           = nullptr;
static ID3D11DeviceContext*    g_pd3dDeviceContext    = nullptr;
static IDXGISwapChain*         g_pSwapChain           = nullptr;
static UINT                    g_ResizeWidth           = 0;
static UINT                    g_ResizeHeight          = 0;
static ID3D11RenderTargetView* g_mainRenderTargetView  = nullptr;

// ─── Logo texture ─────────────────────────────────────────────────────────
static ID3D11ShaderResourceView* g_logoSRV = nullptr;
static int g_logoW = 0, g_logoH = 0;

static void LoadLogoTexture() {
    char exePath[MAX_PATH] = {};
    GetModuleFileNameA(nullptr, exePath, MAX_PATH);
    char* last = strrchr(exePath, '\\');
    if (last) *(last + 1) = '\0';
    char path[MAX_PATH];
    snprintf(path, sizeof(path), "%sassets\\logo.png", exePath);

    int w, h, ch;
    unsigned char* data = stbi_load(path, &w, &h, &ch, 4);
    if (!data) return;

    D3D11_TEXTURE2D_DESC td = {};
    td.Width = (UINT)w; td.Height = (UINT)h;
    td.MipLevels = 1; td.ArraySize = 1;
    td.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;

    D3D11_SUBRESOURCE_DATA sd = {};
    sd.pSysMem = data; sd.SysMemPitch = (UINT)(w * 4);

    ID3D11Texture2D* tex = nullptr;
    if (SUCCEEDED(g_pd3dDevice->CreateTexture2D(&td, &sd, &tex))) {
        D3D11_SHADER_RESOURCE_VIEW_DESC srv = {};
        srv.Format = td.Format;
        srv.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        srv.Texture2D.MipLevels = 1;
        g_pd3dDevice->CreateShaderResourceView(tex, &srv, &g_logoSRV);
        tex->Release();
        g_logoW = w; g_logoH = h;
    }
    stbi_image_free(data);
}

// ─── Phase ────────────────────────────────────────────────────────────────
enum class AppPhase { Loading, Main };
static AppPhase g_phase     = AppPhase::Loading;
static float    g_loadTimer = 0.f;
static bool     g_wantClose = false;

static const float LOAD_DURATION = 3.5f;
static const char* kLoadMsgs[] = {
    "Initializing DirectX 11...",
    "Loading system profiles...",
    "Scanning registry...",
    "Preparing tweak database...",
    "Verifying admin privileges...",
    "Loading optimization presets...",
    "All systems ready.",
};
static const int kLoadMsgCount = 7;

// ─── App state ────────────────────────────────────────────────────────────
struct AppState {
    std::atomic<float> progress{ 0.f };
    std::atomic<bool>  running{ false };
    std::mutex         logMutex;
    std::vector<std::pair<std::string, bool>> logLines;
    bool               scrollToBottom = false;
    bool               showRebootDlg  = false;

    void addLog(const std::string& msg, bool ok = true) {
        std::lock_guard<std::mutex> lk(logMutex);
        time_t t = time(nullptr); tm tm_{};
        localtime_s(&tm_, &t);
        char ts[12]; strftime(ts, sizeof(ts), "%H:%M:%S", &tm_);
        logLines.push_back({ std::string("[") + ts + "] " + msg, ok });
        if (logLines.size() > 2000) logLines.erase(logLines.begin());
        scrollToBottom = true;
    }
    void clearLog() {
        std::lock_guard<std::mutex> lk(logMutex);
        logLines.clear();
    }
};
static AppState g_app;
static int      g_section      = 0;   // 0=System 1=Network 2=GPU 3=Cleanup
static int      g_sectionShown = 0;   // section currently displayed
static float    g_fadeAlpha    = 1.f; // cross-fade alpha

// ─── Particle system ──────────────────────────────────────────────────────
struct Particle { float x,y,vx,vy,life,maxLife,r; };
static Particle g_pts[36];
static bool     g_ptsInit = false;

static void InitParticles(float W, float H) {
    unsigned s = 0x4E1A;
    auto rng = [&]{ s ^= s<<13; s ^= s>>17; s ^= s<<5; return s; };
    for (auto& p : g_pts) {
        p.x      = (float)(rng() % (unsigned)W);
        p.y      = (float)(rng() % (unsigned)H);
        p.vx     = ((int)(rng()%100) - 50) * 0.004f;
        p.vy     = -((float)(rng()%80) + 15) * 0.004f;
        p.maxLife= 5.f + (rng()%500)*0.008f;
        p.life   = p.maxLife * (rng()%100)*0.01f;
        p.r      = 0.7f + (rng()%18)*0.1f;
    }
    g_ptsInit = true;
}

static void UpdateParticles(float W, float H, float dt) {
    unsigned s = (unsigned)(ImGui::GetFrameCount() * 1234567u);
    auto rng = [&]{ s^=s<<13; s^=s>>17; s^=s<<5; return s; };
    for (auto& p : g_pts) {
        p.x    += p.vx * dt * 60.f;
        p.y    += p.vy * dt * 60.f;
        p.life -= dt;
        if (p.life <= 0.f || p.y < -4.f || p.x < 0.f || p.x > W) {
            p.x      = (float)(rng() % (unsigned)W);
            p.y      = H + 4.f;
            p.vx     = ((int)(rng()%100)-50)*0.004f;
            p.vy     = -((float)(rng()%80)+15)*0.004f;
            p.maxLife= 5.f + (rng()%500)*0.008f;
            p.life   = p.maxLife;
        }
    }
}

static void DrawParticles(ImDrawList* dl, ImVec2 orig, float W, float H) {
    for (auto& p : g_pts) {
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        float t = p.life / p.maxLife;
        float a = (t < 0.2f ? t*5.f : (t > 0.8f ? (1.f-t)*5.f : 1.f)) * 0.25f;
        if (a < 0.01f) continue;
        dl->AddCircleFilled({orig.x+p.x, orig.y+p.y}, p.r,
            IM_COL32(115, 88, 235, (int)(a*255)));
    }
}

// ─── Forward decls ────────────────────────────────────────────────────────
static bool CreateDeviceD3D(HWND); static void CleanupDeviceD3D();
static void CreateRenderTarget(); static void CleanupRenderTarget();
LRESULT WINAPI WndProc(HWND, UINT, WPARAM, LPARAM);
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND,UINT,WPARAM,LPARAM);

static bool IsAdmin() {
    BOOL r = FALSE; PSID g = nullptr;
    SID_IDENTIFIER_AUTHORITY a = SECURITY_NT_AUTHORITY;
    if (AllocateAndInitializeSid(&a,2,SECURITY_BUILTIN_DOMAIN_RID,
        DOMAIN_ALIAS_RID_ADMINS,0,0,0,0,0,0,&g)) {
        CheckTokenMembership(nullptr,g,&r); FreeSid(g);
    }
    return r == TRUE;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COLOUR PALETTE  —  dark glassmorphism · violet accent
// ═══════════════════════════════════════════════════════════════════════════
// Background layers (deep navy-black)
static const ImVec4 C_BG     = {0.024f, 0.022f, 0.064f, 1.f}; // #060610
static const ImVec4 C_BG2    = {0.036f, 0.034f, 0.092f, 1.f}; // #09091A
static const ImVec4 C_CARD   = {0.055f, 0.052f, 0.135f, 1.f}; // #0E0D22
static const ImVec4 C_CARD_H = {0.082f, 0.078f, 0.188f, 1.f}; // #141430
// Violet accent
static const ImVec4 C_ACC    = {0.486f, 0.416f, 0.940f, 1.f}; // #7C6AF0
static const ImVec4 C_ACC2   = {0.648f, 0.580f, 1.000f, 1.f}; // #A594FF
static const ImVec4 C_ACCD   = {0.200f, 0.165f, 0.478f, 1.f}; // #332A7A
static const ImVec4 C_ACCDD  = {0.090f, 0.072f, 0.230f, 1.f}; // #17123A
// Text
static const ImVec4 C_TEXT   = {0.920f, 0.908f, 0.960f, 1.f}; // #EAE7F5
static const ImVec4 C_DIM    = {0.435f, 0.415f, 0.555f, 1.f}; // #6F6A8E
static const ImVec4 C_DIM2   = {0.210f, 0.200f, 0.290f, 1.f}; // #35334A
// Status
static const ImVec4 C_GREEN  = {0.180f, 0.820f, 0.640f, 1.f}; // #2ED1A3
static const ImVec4 C_BORDER = {0.135f, 0.122f, 0.295f, 1.f}; // #221F4B

static ImU32 IC(ImVec4 v, float a = 1.f) {
    return IM_COL32((int)(v.x*255),(int)(v.y*255),(int)(v.z*255),(int)(v.w*a*255));
}

// ─── Theme ────────────────────────────────────────────────────────────────
static void ApplyTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding    = 0.f;
    s.ChildRounding     = 8.f;
    s.FrameRounding     = 6.f;
    s.GrabRounding      = 4.f;
    s.TabRounding       = 6.f;
    s.ScrollbarRounding = 6.f;
    s.PopupRounding     = 10.f;
    s.WindowBorderSize  = 0.f;
    s.FrameBorderSize   = 1.f;
    s.WindowPadding     = {18.f, 14.f};
    s.FramePadding      = {12.f, 7.f};
    s.ItemSpacing       = {10.f, 8.f};
    s.ScrollbarSize     = 8.f;

    auto* c = s.Colors;
    c[ImGuiCol_WindowBg]             = C_BG;
    c[ImGuiCol_ChildBg]              = C_BG2;
    c[ImGuiCol_PopupBg]              = {0.042f,0.038f,0.105f,0.97f};
    c[ImGuiCol_FrameBg]              = C_CARD;
    c[ImGuiCol_FrameBgHovered]       = C_CARD_H;
    c[ImGuiCol_FrameBgActive]        = C_CARD_H;
    c[ImGuiCol_TitleBg]              = C_BG;
    c[ImGuiCol_TitleBgActive]        = C_BG;
    c[ImGuiCol_Button]               = C_CARD;
    c[ImGuiCol_ButtonHovered]        = C_CARD_H;
    c[ImGuiCol_ButtonActive]         = C_ACCDD;
    c[ImGuiCol_Header]               = C_CARD;
    c[ImGuiCol_HeaderHovered]        = C_CARD_H;
    c[ImGuiCol_HeaderActive]         = C_ACCDD;
    c[ImGuiCol_Tab]                  = C_BG2;
    c[ImGuiCol_TabHovered]           = C_CARD_H;
    c[ImGuiCol_TabActive]            = C_CARD;
    c[ImGuiCol_TabUnfocused]         = C_BG;
    c[ImGuiCol_TabUnfocusedActive]   = C_BG2;
    c[ImGuiCol_ScrollbarBg]          = C_BG;
    c[ImGuiCol_ScrollbarGrab]        = C_ACCD;
    c[ImGuiCol_ScrollbarGrabHovered] = C_ACC;
    c[ImGuiCol_ScrollbarGrabActive]  = C_ACC2;
    c[ImGuiCol_SliderGrab]           = C_ACC;
    c[ImGuiCol_SliderGrabActive]     = C_ACC2;
    c[ImGuiCol_CheckMark]            = C_ACC2;
    c[ImGuiCol_Separator]            = C_BORDER;
    c[ImGuiCol_SeparatorHovered]     = C_ACCD;
    c[ImGuiCol_SeparatorActive]      = C_ACC;
    c[ImGuiCol_Border]               = C_BORDER;
    c[ImGuiCol_BorderShadow]         = {0,0,0,0};
    c[ImGuiCol_Text]                 = C_TEXT;
    c[ImGuiCol_TextDisabled]         = C_DIM;
    c[ImGuiCol_TextSelectedBg]       = C_ACCDD;
    c[ImGuiCol_PlotHistogram]        = C_ACC;
    c[ImGuiCol_PlotHistogramHovered] = C_ACC2;
    c[ImGuiCol_ResizeGrip]           = C_ACCD;
    c[ImGuiCol_ResizeGripHovered]    = C_ACC;
    c[ImGuiCol_ResizeGripActive]     = C_ACC2;
    c[ImGuiCol_NavHighlight]         = C_ACC;
    c[ImGuiCol_ModalWindowDimBg]     = {0.01f,0.01f,0.04f,0.80f};
    c[ImGuiCol_MenuBarBg]            = C_BG;
}

// ─── Async ────────────────────────────────────────────────────────────────
template<typename Fn>
static void RunAsync(Fn&& fn) {
    if (g_app.running.load()) return;
    g_app.running.store(true);
    g_app.progress.store(0.f);
    g_app.clearLog();
    std::thread([fn = std::forward<Fn>(fn)]() mutable {
        fn(); g_app.running.store(false);
    }).detach();
}
static LogCallback MakeLog() {
    return [](const std::string& m, bool ok){ g_app.addLog(m, ok); };
}

// ─── Button helpers ───────────────────────────────────────────────────────
static bool AccentButton(const char* label, ImVec2 sz = {0,0}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        C_CARD);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, C_CARD_H);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  C_ACCDD);
    ImGui::PushStyleColor(ImGuiCol_Border,        C_ACCD);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.f);
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(4);
    if (ImGui::IsItemHovered()) {
        auto rMin = ImGui::GetItemRectMin();
        auto rMax = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(rMin, rMax, IC(C_ACC, 0.70f), 6.f, 0, 1.5f);
    }
    return hit;
}

static bool PrimaryButton(const char* label, ImVec2 sz = {0,0}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.30f,0.24f,0.60f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.42f,0.35f,0.74f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.22f,0.17f,0.46f,1.f));
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXT);
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleColor(4);
    if (ImGui::IsItemHovered()) {
        float t = (float)ImGui::GetTime();
        float p = 0.5f + 0.5f * sinf(t * 3.5f);
        auto rMin = ImGui::GetItemRectMin();
        auto rMax = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(rMin, rMax, IC(C_ACC2, p * 0.72f), 6.f, 0, 2.f);
    }
    return hit;
}

// ─── Spinner ──────────────────────────────────────────────────────────────
static void DrawSpinner(ImDrawList* dl, ImVec2 C, float r, float thick, float t) {
    const int N = 64; const float arc = 0.55f; const float spd = 2.0f;
    for (int i = 0; i < (int)(N*arc); i++) {
        float a0 = t*spd + (float)i/N * IM_PI*2.f;
        float a1 = t*spd + (float)(i+1)/N * IM_PI*2.f;
        float alpha = (float)i / (N*arc);
        ImVec2 p0 = {C.x+cosf(a0)*r, C.y+sinf(a0)*r};
        ImVec2 p1 = {C.x+cosf(a1)*r, C.y+sinf(a1)*r};
        dl->AddLine(p0, p1, IM_COL32(120,98,240,(ImU8)(alpha*230)), thick);
    }
    float ta = t*spd + arc*IM_PI*2.f;
    ImVec2 tip = {C.x+cosf(ta)*r, C.y+sinf(ta)*r};
    dl->AddCircleFilled(tip, thick*1.6f, IM_COL32(185,165,255,255));
}

// ─── Loading screen ───────────────────────────────────────────────────────
static void DrawLoadingScreen() {
    ImGuiIO& io = ImGui::GetIO();
    float t     = (float)ImGui::GetTime();
    float prog  = std::min(g_loadTimer / LOAD_DURATION, 1.f);

    ImGui::SetNextWindowPos({0,0});
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0,0});
    ImGui::Begin("##splash", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|
        ImGuiWindowFlags_NoMove|ImGuiWindowFlags_NoScrollbar|
        ImGuiWindowFlags_NoBringToFrontOnFocus|ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 cx = {io.DisplaySize.x*0.5f, io.DisplaySize.y*0.5f};

    // Dot grid background
    for (int x = 0; x < (int)io.DisplaySize.x; x += 52)
        for (int y = 0; y < (int)io.DisplaySize.y; y += 52)
            dl->AddCircleFilled({(float)x,(float)y}, 0.9f, IM_COL32(75,55,175,20));

    // Radial ambient glow behind card
    for (int i = 5; i >= 0; i--) {
        float rr  = 180.f + i*55.f;
        float aa  = 0.14f - i*0.022f + 0.04f*sinf(t*0.75f + i*0.4f);
        if (aa > 0.f)
            dl->AddCircleFilled(cx, rr, IM_COL32(72,50,195,(int)(aa*255)), 96);
    }

    // ── Glass card ────────────────────────────────────────────────────────
    const float cW = 340.f, cH = 310.f;
    const float cX = cx.x - cW*0.5f, cY = cx.y - cH*0.5f;
    const float cR = 14.f;

    // Card drop shadow
    for (int i = 3; i >= 0; i--) {
        float e = 6.f + i*8.f;
        dl->AddRectFilled({cX-e, cY-e}, {cX+cW+e, cY+cH+e},
            IM_COL32(6,5,22,(int)((0.60f-i*0.14f)*255)), cR+e*0.6f);
    }

    // Card body
    dl->AddRectFilled({cX,cY},{cX+cW,cY+cH}, IM_COL32(11,10,28,245), cR);

    // Inner top sheen (glass highlight)
    dl->AddRectFilled({cX+1.f,cY+1.f},{cX+cW-1.f,cY+28.f},
        IM_COL32(175,155,255,9), cR);

    // Card border (pulsing)
    float bp = 0.38f + 0.18f*sinf(t*1.3f);
    dl->AddRect({cX,cY},{cX+cW,cY+cH},
        IM_COL32(122,98,242,(int)(bp*72)), cR, 0, 1.2f);

    // Top accent line
    dl->AddLine({cX+cR, cY+0.7f},{cX+cW-cR, cY+0.7f},
        IM_COL32(155,128,255,(int)(bp*130)), 1.5f);

    // ── Content inside card ───────────────────────────────────────────────
    float iY = cY + 30.f;

    // Logo
    if (g_logoSRV) {
        const float ls = 44.f;
        float lx = cx.x - ls*0.5f;
        dl->AddImage((ImTextureID)g_logoSRV, {lx, iY}, {lx+ls, iY+ls});
        iY += ls + 14.f;
    }

    // Brand name
    ImGui::SetWindowFontScale(2.0f);
    {
        const char* brand = "EMINENCE";
        float bW = ImGui::CalcTextSize(brand).x;
        ImGui::SetCursorScreenPos({cx.x - bW*0.5f, iY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_ACC2);
        ImGui::Text("%s", brand);
        ImGui::PopStyleColor();
        iY += ImGui::GetTextLineHeight() + 2.f;
    }
    ImGui::SetWindowFontScale(1.f);
    {
        const char* sub = "TWEAK";
        float sW = ImGui::CalcTextSize(sub).x;
        ImGui::SetCursorScreenPos({cx.x - sW*0.5f, iY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
        ImGui::Text("%s", sub);
        ImGui::PopStyleColor();
        iY += ImGui::GetTextLineHeight() + 10.f;
    }

    // Thin separator inside card
    dl->AddLine({cX+36.f, iY}, {cX+cW-36.f, iY}, IM_COL32(95,75,190,38), 0.8f);
    iY += 10.f;

    // Subtitle / version
    {
        const char* ver = "Gaming PC Optimizer  \xe2\x80\x94  v3.0";
        float vW = ImGui::CalcTextSize(ver).x;
        ImGui::SetCursorScreenPos({cx.x - vW*0.5f, iY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::Text("%s", ver);
        ImGui::PopStyleColor();
        iY += ImGui::GetTextLineHeight() + 22.f;
    }

    // Spinner (centered)
    DrawSpinner(dl, {cx.x, iY + 33.f}, 30.f, 2.4f, t);
    DrawSpinner(dl, {cx.x, iY + 33.f}, 18.f, 1.3f, -t*0.7f);
    float dot = 0.55f + 0.45f*sinf(t*5.f);
    dl->AddCircleFilled({cx.x, iY+33.f}, 3.2f*dot, IM_COL32(165,145,255,255));
    iY += 76.f;

    // Progress bar (gradient)
    float bW2 = cW - 56.f;
    float bX  = cX + 28.f;
    dl->AddRectFilled({bX,iY},{bX+bW2,iY+2.5f}, IM_COL32(26,22,66,255), 2.f);
    if (prog > 0.f) {
        dl->AddRectFilledMultiColor(
            {bX,iY},{bX+bW2*prog,iY+2.5f},
            IM_COL32(72,55,195,255), IM_COL32(160,138,255,255),
            IM_COL32(160,138,255,255), IM_COL32(72,55,195,255));
        float tx = bX + bW2*prog;
        dl->AddCircleFilled({tx, iY+1.2f}, 4.5f, IM_COL32(150,125,255,48));
        dl->AddCircleFilled({tx, iY+1.2f}, 2.2f, IM_COL32(195,178,255,255));
    }
    iY += 13.f;

    // Status message + percent
    int mi = std::min((int)(prog*kLoadMsgCount), kLoadMsgCount-1);
    float mW = ImGui::CalcTextSize(kLoadMsgs[mi]).x;
    ImGui::SetCursorScreenPos({cx.x - mW*0.5f, iY});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
    ImGui::Text("%s", kLoadMsgs[mi]);
    ImGui::PopStyleColor();

    char pct[10]; snprintf(pct,sizeof(pct),"%.0f%%",prog*100.f);
    float pW = ImGui::CalcTextSize(pct).x;
    ImGui::SetCursorScreenPos({cX+cW-28.f-pW, iY});
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACC);
    ImGui::Text("%s", pct);
    ImGui::PopStyleColor();

    // Bottom discord
    ImGui::SetCursorPos({18.f, io.DisplaySize.y-26.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::Text("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    ImGui::End();
    if (g_loadTimer >= LOAD_DURATION) g_phase = AppPhase::Main;
}

// ─── Log panel ────────────────────────────────────────────────────────────
static void DrawLog(float h) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.028f,0.026f,0.072f,1.f));
    ImGui::PushStyleColor(ImGuiCol_Border,  C_BORDER);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.f);
    if (ImGui::BeginChild("##log",{-1.f,h},true,ImGuiWindowFlags_HorizontalScrollbar)) {
        std::lock_guard<std::mutex> lk(g_app.logMutex);
        ImGuiListClipper clipper;
        clipper.Begin((int)g_app.logLines.size());
        while (clipper.Step())
            for (int i=clipper.DisplayStart; i<clipper.DisplayEnd; i++) {
                auto& [txt,ok] = g_app.logLines[i];
                bool hdr = txt.find("====")!=std::string::npos || txt.find(">> ")!=std::string::npos;
                ImVec4 col = hdr ? C_ACC2 : (ok ? C_GREEN : C_DIM);
                ImGui::TextColored(col, "%s", txt.c_str());
            }
        if (g_app.scrollToBottom) { ImGui::SetScrollHereY(1.f); g_app.scrollToBottom=false; }
        ImGui::EndChild();
    }
    ImGui::PopStyleVar(); ImGui::PopStyleColor(2);
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────
static bool NavItem(const char* label, bool active, float w) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 pos     = ImGui::GetCursorScreenPos();
    const float h  = 42.f;
    float t        = (float)ImGui::GetTime();
    ImGui::InvisibleButton(label, {w, h});
    bool hov     = ImGui::IsItemHovered();
    bool clicked = ImGui::IsItemClicked();

    if (active) {
        float pulse = 0.28f + 0.10f*sinf(t*1.8f);
        // Background
        dl->AddRectFilled(pos, {pos.x+w, pos.y+h}, IM_COL32(14,12,35,255));
        // Layered left glow
        dl->AddRectFilled({pos.x,pos.y},{pos.x+20.f,pos.y+h},
            IM_COL32(100,78,222,(int)(pulse*70)));
        dl->AddRectFilled({pos.x,pos.y},{pos.x+8.f,pos.y+h},
            IM_COL32(128,104,240,(int)(pulse*105)));
        // Solid left accent bar
        dl->AddRectFilled({pos.x,pos.y+8.f},{pos.x+3.f,pos.y+h-8.f}, IC(C_ACC));
        // Right side subtle glow
        dl->AddRectFilled({pos.x+w-14.f,pos.y},{pos.x+w,pos.y+h},
            IM_COL32(80,60,190,(int)(pulse*30)));
    } else if (hov) {
        dl->AddRectFilled(pos, {pos.x+w, pos.y+h}, IM_COL32(10,9,26,255));
        dl->AddRectFilled({pos.x,pos.y+10.f},{pos.x+2.f,pos.y+h-10.f}, IC(C_ACCD));
    }

    ImVec2 tsz = ImGui::CalcTextSize(label);
    ImU32 tc = active ? ImGui::ColorConvertFloat4ToU32(C_TEXT)
             : (hov   ? IM_COL32(195,185,230,255)
                      : ImGui::ColorConvertFloat4ToU32(C_DIM));
    dl->AddText({pos.x+16.f, pos.y+(h-tsz.y)*0.5f}, tc, label);
    return clicked;
}

// ─── Glass card button ────────────────────────────────────────────────────
static bool CardButton(const char* id, const char* label, ImVec2 sz, bool disabled=false) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 pos     = ImGui::GetCursorScreenPos();
    bool clicked   = false, hov = false;
    if (disabled) {
        ImGui::Dummy(sz);
    } else {
        ImGui::InvisibleButton(id, sz);
        clicked = ImGui::IsItemClicked();
        hov     = ImGui::IsItemHovered();
    }
    float a = disabled ? 0.40f : 1.f;

    // Card body
    ImU32 bg = hov ? IM_COL32(20,17,52,(int)(255*a))
                   : IM_COL32(13,11,32,(int)(255*a));
    dl->AddRectFilled(pos, {pos.x+sz.x, pos.y+sz.y}, bg, 7.f);

    // Top inner highlight (glass sheen)
    if (hov)
        dl->AddRectFilled(pos, {pos.x+sz.x, pos.y+5.f},
            IM_COL32(155,130,255,(int)(20*a)), 7.f);

    // Border
    float ba = hov ? 0.52f : 0.20f;
    dl->AddRect(pos, {pos.x+sz.x, pos.y+sz.y},
        IM_COL32(116,92,238,(int)(ba*255*a)), 7.f, 0, 1.f);

    // Label
    ImVec2 tsz = ImGui::CalcTextSize(label);
    ImU32 tc = disabled ? IM_COL32(78,68,105,140)
             : (hov     ? ImGui::ColorConvertFloat4ToU32(C_TEXT)
                        : IM_COL32(175,165,218,255));
    dl->AddText({pos.x+14.f, pos.y+(sz.y-tsz.y)*0.5f}, tc, label);
    return clicked;
}

// ─── 2-column grid of tweak groups ───────────────────────────────────────
static void DrawCleanGrid(const std::vector<TweakGroup>& groups) {
    bool  busy  = g_app.running.load();
    float avail = ImGui::GetContentRegionAvail().x;
    float gap   = 8.f;
    float cardW = (avail - gap) / 2.f;
    int   col   = 0;
    for (size_t i = 0; i < groups.size(); i++) {
        std::string id = "##cg" + std::to_string(i);
        if (CardButton(id.c_str(), groups[i].name.c_str(), {cardW, 44.f}, busy)) {
            RunAsync([grp = std::vector<TweakGroup>{groups[i]}]() {
                std::atomic<float> p = 0.f;
                ApplyTweakGroups(grp, p, MakeLog());
                g_app.progress.store(1.f);
            });
        }
        col++;
        if (col < 2) ImGui::SameLine(0.f, gap); else { col=0; ImGui::Dummy({0.f,4.f}); }
    }
}

// ─── Reboot dialog ────────────────────────────────────────────────────────
static void DrawRebootDialog() {
    if (!g_app.showRebootDlg) return;
    ImGui::OpenPopup("Restart Required##r");
    ImGui::SetNextWindowSize({360.f,0.f});
    if (ImGui::BeginPopupModal("Restart Required##r",nullptr,ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Dummy({0,6.f});
        ImGui::TextColored(C_ACC2,"  All tweaks have been applied!");
        ImGui::Separator(); ImGui::Dummy({0,4.f});
        ImGui::TextColored(C_DIM, "  Restart your PC to activate all changes.");
        ImGui::Dummy({0,12.f});
        if (PrimaryButton("  Restart Now  ",{160.f,36.f})) {
            system("shutdown /r /t 5 /c \"Eminence Tweak\"");
            g_app.showRebootDlg=false; ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine(0.f,10.f);
        if (ImGui::Button("  Later  ",{100.f,36.f})) {
            g_app.showRebootDlg=false; ImGui::CloseCurrentPopup();
        }
        ImGui::Dummy({0,6.f}); ImGui::EndPopup();
    }
}

// ─── Title bar ────────────────────────────────────────────────────────────
static bool DrawTitleBar(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();
    const float H = 50.f;
    ImGui::SetNextWindowPos({0,0});
    ImGui::SetNextWindowSize({io.DisplaySize.x, H});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.015f,0.014f,0.042f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{16.f,0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0.f);
    ImGui::Begin("##tb",nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(2); ImGui::PopStyleColor();

    // Logo icon
    float textY = (H - ImGui::GetTextLineHeight()*1.5f)*0.5f;
    float curX  = 16.f;
    if (g_logoSRV) {
        const float icoSize = 28.f;
        ImGui::SetCursorPos({curX, (H - icoSize) * 0.5f});
        ImGui::Image((ImTextureID)g_logoSRV, {icoSize, icoSize});
        ImGui::SameLine(0.f, 10.f);
        curX = ImGui::GetCursorPosX();
    }
    ImGui::SetCursorPos({curX, textY});
    ImGui::SetWindowFontScale(1.22f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACC2);
    ImGui::Text("EMINENCE");
    ImGui::PopStyleColor();
    ImGui::SameLine(0.f,7.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
    ImGui::Text("TWEAK");
    ImGui::PopStyleColor();
    ImGui::SetWindowFontScale(1.f);
    ImGui::SameLine(0.f,9.f);
    ImGui::SetCursorPosY((H-ImGui::GetTextLineHeight())*0.5f+1.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::Text("v3.0");
    ImGui::PopStyleColor();

    // Admin badge
    bool admin = IsAdmin();
    ImGui::SameLine(0.f,22.f);
    ImGui::SetCursorPosY((H-ImGui::GetFrameHeight())*0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, admin ? C_GREEN : C_ACCD);
    ImGui::Text(admin ? " ADMIN" : " NO ADMIN");
    ImGui::PopStyleColor();

    // Discord
    ImGui::SameLine(0.f,18.f);
    ImGui::SetCursorPosY((H-ImGui::GetTextLineHeight())*0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::Text("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    // Window controls
    float ctrlW = 90.f;
    ImGui::SetCursorPos({io.DisplaySize.x-ctrlW, 0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding,0.f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,{0,0});

    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {1.f,1.f,1.f,0.06f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {1.f,1.f,1.f,0.10f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    if (ImGui::Button(" \xe2\x80\x94 ##mn",{45.f,H})) ShowWindow(hwnd,SW_MINIMIZE);
    ImGui::PopStyleColor(4);

    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.62f,0.07f,0.07f,1.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {0.44f,0.04f,0.04f,1.f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    bool cls = ImGui::Button(" X ##cl",{45.f,H});
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);

    // Bottom accent hairline
    ImVec2 wp = ImGui::GetWindowPos();
    ImGui::GetWindowDrawList()->AddLine(
        {wp.x, wp.y+H-1.f}, {wp.x+io.DisplaySize.x, wp.y+H-1.f},
        IC(C_BORDER, 0.85f), 1.f);

    ImGui::End();
    return cls;
}

// ─── Main UI ─────────────────────────────────────────────────────────────
static void DrawMainUI(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();
    if (DrawTitleBar(hwnd)) g_wantClose = true;

    const float TB  = 50.f;
    const float SBW = 198.f;
    float sbH = io.DisplaySize.y - TB;

    // ══ SIDEBAR ═══════════════════════════════════════════════════════════
    ImGui::SetNextWindowPos({0.f, TB});
    ImGui::SetNextWindowSize({SBW, sbH});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.014f,0.013f,0.040f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0.f,0.f});
    ImGui::Begin("##sb", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse|
        ImGuiWindowFlags_NoBringToFrontOnFocus|ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

    ImDrawList* sdl = ImGui::GetWindowDrawList();
    ImVec2 sbWP = ImGui::GetWindowPos();
    // Right separator line
    sdl->AddLine({sbWP.x+SBW-1.f, sbWP.y}, {sbWP.x+SBW-1.f, sbWP.y+sbH},
        IC(C_BORDER,0.85f));

    // Logo in sidebar
    ImGui::Dummy({0.f, 14.f});
    if (g_logoSRV) {
        const float ls = 36.f;
        ImGui::SetCursorPosX((SBW - ls) * 0.5f);
        ImGui::Image((ImTextureID)g_logoSRV, {ls, ls});
        ImGui::Dummy({0.f, 8.f});
    } else {
        ImGui::Dummy({0.f, 6.f});
    }

    // Separator below logo
    float sepY = sbWP.y + ImGui::GetCursorPosY();
    sdl->AddLine({sbWP.x+14.f, sepY}, {sbWP.x+SBW-15.f, sepY}, IC(C_BORDER,0.50f));
    ImGui::Dummy({0.f, 6.f});

    // Nav items
    const char* sections[] = {"System","Network","GPU","Cleanup"};
    for (int i = 0; i < 4; i++) {
        ImGui::SetCursorPosX(0.f);
        if (NavItem(sections[i], g_section==i, SBW-1.f)) g_section = i;
    }

    // Bottom layout
    bool  busy = g_app.running.load();
    float prog = g_app.progress.load();

    // Status text
    ImGui::SetCursorPos({10.f, sbH - 102.f});
    ImGui::PushStyleColor(ImGuiCol_Text, busy ? C_ACC : C_DIM2);
    ImGui::TextUnformatted(busy ? "Running..." : "Ready");
    ImGui::PopStyleColor();

    // Thin progress bar
    float pbY = sbWP.y + sbH - 82.f;
    sdl->AddRectFilled({sbWP.x+10.f, pbY}, {sbWP.x+SBW-11.f, pbY+3.f},
        IM_COL32(18,15,50,255), 2.f);
    if (prog > 0.f) {
        sdl->AddRectFilledMultiColor(
            {sbWP.x+10.f, pbY},
            {sbWP.x+10.f+(SBW-21.f)*prog, pbY+3.f},
            IM_COL32(70,52,188,255), IM_COL32(148,126,242,255),
            IM_COL32(148,126,242,255), IM_COL32(70,52,188,255));
    }

    // OPTIMIZE ALL button
    ImGui::SetCursorPos({8.f, sbH - 76.f});
    if (busy) ImGui::BeginDisabled();
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.28f,0.22f,0.60f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.40f,0.33f,0.74f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.20f,0.16f,0.46f,1.f));
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXT);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.f);
    if (ImGui::Button("OPTIMIZE ALL##oa", {SBW-16.f, 48.f})) {
        RunAsync([](){
            ApplyAllTweaks(g_app.progress, MakeLog());
            g_app.showRebootDlg = true;
        });
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(4);
    if (busy) ImGui::EndDisabled();
    if (ImGui::IsItemHovered()) {
        float t  = (float)ImGui::GetTime();
        float p2 = 0.38f + 0.28f*sinf(t*3.2f);
        auto rm  = ImGui::GetItemRectMin(); auto rM = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(rm, rM, IC(C_ACC2, p2), 6.f, 0, 2.f);
    }

    // Discord link
    ImGui::SetCursorPos({10.f, sbH - 22.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::TextUnformatted("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    ImGui::End();

    // ══ CONTENT AREA ══════════════════════════════════════════════════════
    // Section cross-fade
    float dt = io.DeltaTime;
    if (g_sectionShown != g_section) {
        g_fadeAlpha -= dt * 8.f;
        if (g_fadeAlpha <= 0.f) { g_fadeAlpha = 0.f; g_sectionShown = g_section; }
    } else {
        g_fadeAlpha = std::min(g_fadeAlpha + dt * 8.f, 1.f);
    }

    float ctW = io.DisplaySize.x - SBW;
    float ctH = io.DisplaySize.y - TB;

    // Particles
    if (!g_ptsInit) InitParticles(ctW, ctH);
    UpdateParticles(ctW, ctH, dt);

    ImGui::SetNextWindowPos({SBW, TB});
    ImGui::SetNextWindowSize({ctW, ctH});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {14.f,10.f});
    ImGui::Begin("##ct", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

    // Background: dot grid + particles
    {
        ImDrawList* bdl = ImGui::GetWindowDrawList();
        ImVec2 wp = ImGui::GetWindowPos();
        for (float x = 0; x < ctW; x += 48.f)
            for (float y = 0; y < ctH; y += 48.f)
                bdl->AddCircleFilled({wp.x+x, wp.y+y}, 0.9f, IM_COL32(55,38,130,22));
        DrawParticles(bdl, wp, ctW, ctH);
    }

    // Section header with fade
    const char* titles[] = {
        "System Tweaks","Network Tweaks","GPU / Driver Tweaks","Cleanup"
    };
    ImGui::Dummy({0.f,4.f});
    ImGui::PushStyleVar(ImGuiStyleVar_Alpha, g_fadeAlpha * ImGui::GetStyle().Alpha);
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACC2);
    ImGui::SetWindowFontScale(1.12f);
    ImGui::Text("%s", titles[g_sectionShown]);
    ImGui::SetWindowFontScale(1.f);
    ImGui::PopStyleColor();
    ImGui::Dummy({0.f,6.f});

    // Scrollable cards
    const float logH    = 155.f;
    float       cardAreaH = ImGui::GetContentRegionAvail().y - logH - 20.f;
    ImGui::PushStyleColor(ImGuiCol_ChildBg, {0,0,0,0});
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 0.f);
    ImGui::BeginChild("##ca", {-1.f, cardAreaH}, false);
    if      (g_sectionShown == 0) DrawCleanGrid(g_systemTweaks);
    else if (g_sectionShown == 1) DrawCleanGrid(g_networkTweaks);
    else if (g_sectionShown == 2) DrawCleanGrid(g_gpuTweaks);
    else {
        ImGui::Dummy({0.f,8.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::TextWrapped("Removes temporary files to free up disk space and improve load times.");
        ImGui::PopStyleColor();
        ImGui::Dummy({0.f,14.f});
        bool busy2 = g_app.running.load();
        if (CardButton("##cln", "  Clean Temp Files", {220.f,50.f}, busy2))
            RunAsync([](){CleanTempFiles(g_app.progress, MakeLog());});
        ImGui::Dummy({0.f,14.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::TextUnformatted("Targets:");
        ImGui::PopStyleColor();
        const char* flds[] = {"%TEMP%","C:\\Windows\\Temp",
                              "C:\\Windows\\Prefetch","%LOCALAPPDATA%\\Temp"};
        for (auto f : flds) {
            ImGui::PushStyleColor(ImGuiCol_Text, C_ACCD);
            ImGui::Text("  * %s", f);
            ImGui::PopStyleColor();
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleVar(2); ImGui::PopStyleColor(); // ChildRounding + fadeAlpha + ChildBg

    // Log panel
    ImGui::Dummy({0.f,4.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
    ImGui::TextUnformatted("Output");
    ImGui::PopStyleColor();
    ImGui::SameLine(0.f,8.f);
    if (ImGui::SmallButton("Clear")) g_app.clearLog();
    ImGui::SameLine(0.f,6.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::Text("%zu lines", (size_t)g_app.logLines.size());
    ImGui::PopStyleColor();
    DrawLog(ImGui::GetContentRegionAvail().y - 4.f);

    DrawRebootDialog();
    ImGui::End();
}

// ─── D3D11 ────────────────────────────────────────────────────────────────
static bool CreateDeviceD3D(HWND hWnd) {
    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount = 2;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.Flags = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = hWnd; sd.SampleDesc.Count = 1;
    sd.Windowed = TRUE; sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    D3D_FEATURE_LEVEL fla[2] = {D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0};
    D3D_FEATURE_LEVEL fl;
    HRESULT r = D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_HARDWARE,
        nullptr,0,fla,2,D3D11_SDK_VERSION,&sd,&g_pSwapChain,&g_pd3dDevice,&fl,&g_pd3dDeviceContext);
    if (r == DXGI_ERROR_UNSUPPORTED)
        r = D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_WARP,
            nullptr,0,fla,2,D3D11_SDK_VERSION,&sd,&g_pSwapChain,&g_pd3dDevice,&fl,&g_pd3dDeviceContext);
    if (FAILED(r)) return false;
    CreateRenderTarget(); return true;
}
static void CleanupDeviceD3D() {
    CleanupRenderTarget();
    if (g_pSwapChain)        {g_pSwapChain->Release();        g_pSwapChain=nullptr;}
    if (g_pd3dDeviceContext) {g_pd3dDeviceContext->Release(); g_pd3dDeviceContext=nullptr;}
    if (g_pd3dDevice)        {g_pd3dDevice->Release();        g_pd3dDevice=nullptr;}
}
static void CreateRenderTarget() {
    ID3D11Texture2D* b=nullptr;
    g_pSwapChain->GetBuffer(0,IID_PPV_ARGS(&b));
    g_pd3dDevice->CreateRenderTargetView(b,nullptr,&g_mainRenderTargetView);
    b->Release();
}
static void CleanupRenderTarget() {
    if (g_mainRenderTargetView) {g_mainRenderTargetView->Release(); g_mainRenderTargetView=nullptr;}
}

// ─── WndProc ──────────────────────────────────────────────────────────────
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (ImGui_ImplWin32_WndProcHandler(hWnd,msg,wParam,lParam)) return TRUE;
    switch (msg) {
    case WM_SIZE:
        if (wParam==SIZE_MINIMIZED) return 0;
        g_ResizeWidth=LOWORD(lParam); g_ResizeHeight=HIWORD(lParam);
        return 0;
    case WM_NCHITTEST: {
        LRESULT hit = DefWindowProcW(hWnd,msg,wParam,lParam);
        if (hit==HTCLIENT) {
            POINT pt; GetCursorPos(&pt); ScreenToClient(hWnd,&pt);
            if (pt.y<50 && pt.x < (int)GetSystemMetrics(SM_CXSCREEN)-95)
                return HTCAPTION;
        }
        return hit;
    }
    case WM_SYSCOMMAND:
        if ((wParam&0xFFF0)==SC_KEYMENU) return 0;
        break;
    case WM_DESTROY:
        PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(hWnd,msg,wParam,lParam);
}

// ─── WinMain ──────────────────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
    WNDCLASSEXW wc = {sizeof(wc),CS_CLASSDC,WndProc,0L,0L,
        GetModuleHandleW(nullptr),nullptr,nullptr,nullptr,nullptr,
        L"EminenceTweak3",nullptr};
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName,
        L"Eminence Tweak \xe2\x80\x94 Gaming Optimizer",
        WS_POPUP|WS_VISIBLE|WS_SYSMENU|WS_MINIMIZEBOX,
        120,80, 960,700,
        nullptr,nullptr,wc.hInstance,nullptr);

    // DWM: rounded corners + shadow
    DWORD cp = 2;
    DwmSetWindowAttribute(hwnd, 33, &cp, sizeof(cp));
    MARGINS m = {1,1,1,1};
    DwmExtendFrameIntoClientArea(hwnd,&m);

    if (!CreateDeviceD3D(hwnd)) {
        CleanupDeviceD3D(); UnregisterClassW(wc.lpszClassName,wc.hInstance);
        return 1;
    }
    ShowWindow(hwnd,SW_SHOWDEFAULT);
    UpdateWindow(hwnd);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ApplyTheme();
    ImGui_ImplWin32_Init(hwnd);
    ImGui_ImplDX11_Init(g_pd3dDevice, g_pd3dDeviceContext);
    LoadLogoTexture();

    // Font
    const char* ff[] = {
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\calibri.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
    };
    bool fl = false;
    for (auto fp : ff)
        if (GetFileAttributesA(fp)!=INVALID_FILE_ATTRIBUTES)
            { io.Fonts->AddFontFromFileTTF(fp,15.f); fl=true; break; }
    if (!fl) io.Fonts->AddFontDefault();

    // Clear colour matches C_BG
    constexpr float CLEAR[4] = {0.024f, 0.022f, 0.064f, 1.f};

    MSG msg = {};
    while (msg.message != WM_QUIT) {
        if (PeekMessageW(&msg,nullptr,0U,0U,PM_REMOVE)) {
            TranslateMessage(&msg); DispatchMessageW(&msg); continue;
        }
        if (g_wantClose) break;
        if (g_ResizeWidth!=0 && g_ResizeHeight!=0) {
            CleanupRenderTarget();
            g_pSwapChain->ResizeBuffers(0,g_ResizeWidth,g_ResizeHeight,DXGI_FORMAT_UNKNOWN,0);
            g_ResizeWidth=g_ResizeHeight=0;
            CreateRenderTarget();
        }
        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();

        if (g_phase == AppPhase::Loading) { g_loadTimer+=io.DeltaTime; DrawLoadingScreen(); }
        else DrawMainUI(hwnd);

        ImGui::Render();
        g_pd3dDeviceContext->OMSetRenderTargets(1,&g_mainRenderTargetView,nullptr);
        g_pd3dDeviceContext->ClearRenderTargetView(g_mainRenderTargetView,CLEAR);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
        g_pSwapChain->Present(1,0);
    }

    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();
    if (g_logoSRV) { g_logoSRV->Release(); g_logoSRV = nullptr; }
    CleanupDeviceD3D();
    DestroyWindow(hwnd);
    UnregisterClassW(wc.lpszClassName,wc.hInstance);
    return 0;
}
