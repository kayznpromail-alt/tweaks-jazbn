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
static int      g_tab          = 0;   // 0=Tweaks 1=Undo Changes

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
            IM_COL32(0, 185, 210, (int)(a*255)));
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
//  COLOUR PALETTE  —  dark · cyan accent  (EDGEY style)
// ═══════════════════════════════════════════════════════════════════════════
// Background
static const ImVec4 C_BG     = {0.030f, 0.028f, 0.050f, 1.f}; // #070713
static const ImVec4 C_BG2    = {0.042f, 0.040f, 0.068f, 1.f}; // #0B0A11
static const ImVec4 C_CARD   = {0.055f, 0.052f, 0.088f, 1.f}; // #0E0D16
static const ImVec4 C_CARD_H = {0.070f, 0.068f, 0.110f, 1.f}; // #12111C
// Cyan accent
static const ImVec4 C_ACC    = {0.000f, 0.690f, 0.780f, 1.f}; // #00B0C7
static const ImVec4 C_ACC2   = {0.000f, 0.840f, 0.940f, 1.f}; // #00D6EF
static const ImVec4 C_ACCD   = {0.000f, 0.360f, 0.420f, 1.f}; // #005C6B
static const ImVec4 C_ACCDD  = {0.000f, 0.185f, 0.220f, 1.f}; // #002F38
// Text
static const ImVec4 C_TEXT   = {0.930f, 0.950f, 0.965f, 1.f}; // #EDF2F7
static const ImVec4 C_DIM    = {0.420f, 0.455f, 0.510f, 1.f}; // #6B7482
static const ImVec4 C_DIM2   = {0.200f, 0.220f, 0.260f, 1.f}; // #333843
// Status
static const ImVec4 C_GREEN  = {0.180f, 0.820f, 0.640f, 1.f}; // #2ED1A3
static const ImVec4 C_BORDER = {0.040f, 0.380f, 0.440f, 1.f}; // #0A6170

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
    c[ImGuiCol_PopupBg]              = {0.036f,0.034f,0.060f,0.97f};
    c[ImGuiCol_FrameBg]              = C_CARD;
    c[ImGuiCol_FrameBgHovered]       = C_CARD_H;
    c[ImGuiCol_FrameBgActive]        = C_CARD_H;
    c[ImGuiCol_TitleBg]              = C_BG;
    c[ImGuiCol_TitleBgActive]        = C_BG;
    c[ImGuiCol_Button]               = C_ACCD;
    c[ImGuiCol_ButtonHovered]        = C_ACC;
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
    c[ImGuiCol_ModalWindowDimBg]     = {0.01f,0.01f,0.03f,0.80f};
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
    ImGui::PushStyleColor(ImGuiCol_Button,        C_ACC);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, C_ACC2);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  C_ACCD);
    ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.f,0.f,0.f,1.f));
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleColor(4);
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
        dl->AddLine(p0, p1, IM_COL32(0,185,210,(ImU8)(alpha*230)), thick);
    }
    float ta = t*spd + arc*IM_PI*2.f;
    ImVec2 tip = {C.x+cosf(ta)*r, C.y+sinf(ta)*r};
    dl->AddCircleFilled(tip, thick*1.6f, IM_COL32(0,220,245,255));
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
            dl->AddCircleFilled({(float)x,(float)y}, 0.9f, IM_COL32(0,130,155,18));

    // Radial ambient glow behind card
    for (int i = 5; i >= 0; i--) {
        float rr  = 180.f + i*55.f;
        float aa  = 0.12f - i*0.018f + 0.035f*sinf(t*0.75f + i*0.4f);
        if (aa > 0.f)
            dl->AddCircleFilled(cx, rr, IM_COL32(0,155,178,(int)(aa*255)), 96);
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
    dl->AddRectFilled({cX,cY},{cX+cW,cY+cH}, IM_COL32(9,9,20,248), cR);

    // Inner top sheen (glass highlight)
    dl->AddRectFilled({cX+1.f,cY+1.f},{cX+cW-1.f,cY+28.f},
        IM_COL32(0,190,220,8), cR);

    // Card border (pulsing)
    float bp = 0.38f + 0.18f*sinf(t*1.3f);
    dl->AddRect({cX,cY},{cX+cW,cY+cH},
        IM_COL32(0,165,188,(int)(bp*80)), cR, 0, 1.2f);

    // Top accent line
    dl->AddLine({cX+cR, cY+0.7f},{cX+cW-cR, cY+0.7f},
        IM_COL32(0,200,228,(int)(bp*140)), 1.5f);

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
        const char* b1 = "EMINENCE"; const char* b2 = " TWEAK";
        float bW = ImGui::CalcTextSize(b1).x + ImGui::CalcTextSize(b2).x;
        ImGui::SetCursorScreenPos({cx.x - bW*0.5f, iY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
        ImGui::Text("%s", b1);
        ImGui::PopStyleColor();
        ImGui::SameLine(0.f,0.f);
        ImGui::PushStyleColor(ImGuiCol_Text, C_ACC2);
        ImGui::Text("%s", b2);
        ImGui::PopStyleColor();
        iY += ImGui::GetTextLineHeight() + 4.f;
    }
    ImGui::SetWindowFontScale(1.f);
    {
        const char* sub = "GAMING PC OPTIMIZER";
        float sW = ImGui::CalcTextSize(sub).x;
        ImGui::SetCursorScreenPos({cx.x - sW*0.5f, iY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::Text("%s", sub);
        ImGui::PopStyleColor();
        iY += ImGui::GetTextLineHeight() + 10.f;
    }

    // Thin separator inside card
    dl->AddLine({cX+36.f, iY}, {cX+cW-36.f, iY}, IM_COL32(0,140,165,40), 0.8f);
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
    dl->AddRectFilled({bX,iY},{bX+bW2,iY+2.5f}, IM_COL32(0,45,55,255), 2.f);
    if (prog > 0.f) {
        dl->AddRectFilledMultiColor(
            {bX,iY},{bX+bW2*prog,iY+2.5f},
            IM_COL32(0,140,165,255), IM_COL32(0,210,240,255),
            IM_COL32(0,210,240,255), IM_COL32(0,140,165,255));
        float tx = bX + bW2*prog;
        dl->AddCircleFilled({tx, iY+1.2f}, 4.5f, IM_COL32(0,200,230,48));
        dl->AddCircleFilled({tx, iY+1.2f}, 2.2f, IM_COL32(0,230,255,255));
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

// ─── Flat cyan button (EDGEY style) ──────────────────────────────────────
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
    float a = disabled ? 0.35f : 1.f;

    // Solid cyan fill
    ImU32 bg = hov ? IM_COL32(0,190,215,(int)(255*a))
                   : IM_COL32(0,160,182,(int)(255*a));
    dl->AddRectFilled(pos, {pos.x+sz.x, pos.y+sz.y}, bg, 8.f);

    // Top inner highlight
    if (!disabled)
        dl->AddRectFilled(pos, {pos.x+sz.x, pos.y+4.f},
            IM_COL32(255,255,255,(int)(hov?22:14)), 8.f);

    // Label centered
    ImVec2 tsz = ImGui::CalcTextSize(label);
    float tx = pos.x + (sz.x - tsz.x) * 0.5f;
    float ty = pos.y + (sz.y - tsz.y) * 0.5f;
    ImU32 tc = disabled ? IM_COL32(200,235,240,90) : IM_COL32(255,255,255,255);
    dl->AddText({tx, ty}, tc, label);
    return clicked;
}

// ─── 3-column grid of tweak groups ───────────────────────────────────────
static void DrawTweakGrid(const std::vector<TweakGroup>& groups, int idOffset = 0) {
    bool  busy  = g_app.running.load();
    float avail = ImGui::GetContentRegionAvail().x;
    float gap   = 8.f;
    float cardW = (avail - gap*2.f) / 3.f;
    int   col   = 0;
    for (size_t i = 0; i < groups.size(); i++) {
        std::string id = "##cg" + std::to_string(i + idOffset);
        if (CardButton(id.c_str(), groups[i].name.c_str(), {cardW, 48.f}, busy)) {
            RunAsync([grp = std::vector<TweakGroup>{groups[i]}]() {
                std::atomic<float> p = 0.f;
                ApplyTweakGroups(grp, p, MakeLog());
                g_app.progress.store(1.f);
            });
        }
        col++;
        if (col < 3) ImGui::SameLine(0.f, gap);
        else { col = 0; ImGui::Dummy({0.f, 6.f}); }
    }
}

// ─── Combined all-tweaks grid (Tweaks tab) ────────────────────────────────
static void DrawAllTweaksGrid() {
    bool  busy  = g_app.running.load();
    float avail = ImGui::GetContentRegionAvail().x;
    float gap   = 8.f;
    float cardW = (avail - gap*2.f) / 3.f;
    const float cardH = 48.f;
    int   col   = 0;

    // Combine all groups + cleanup
    std::vector<const TweakGroup*> all;
    for (auto& g : g_systemTweaks)  all.push_back(&g);
    for (auto& g : g_networkTweaks) all.push_back(&g);
    for (auto& g : g_gpuTweaks)     all.push_back(&g);

    for (size_t i = 0; i < all.size(); i++) {
        std::string id = "##ag" + std::to_string(i);
        if (CardButton(id.c_str(), all[i]->name.c_str(), {cardW, cardH}, busy)) {
            RunAsync([grp = std::vector<TweakGroup>{*all[i]}]() {
                std::atomic<float> p = 0.f;
                ApplyTweakGroups(grp, p, MakeLog());
                g_app.progress.store(1.f);
            });
        }
        col++;
        if (col < 3) ImGui::SameLine(0.f, gap);
        else { col = 0; ImGui::Dummy({0.f, 6.f}); }
    }

    // Cleanup button
    std::string cid = "##agcln";
    if (CardButton(cid.c_str(), "Clean Temp Files", {cardW, cardH}, busy)) {
        RunAsync([](){CleanTempFiles(g_app.progress, MakeLog());});
    }
    col++;
    if (col < 3) ImGui::SameLine(0.f, gap);
    else { col = 0; ImGui::Dummy({0.f, 6.f}); }
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

// ─── Header (EDGEY-style: logo left, title centred, controls right) ───────
static const float HDR_H = 110.f;
static const float TAB_H = 52.f;

static bool DrawHeader(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos({0,0});
    ImGui::SetNextWindowSize({io.DisplaySize.x, HDR_H});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.018f,0.017f,0.032f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{0.f,0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0.f);
    ImGui::Begin("##hdr",nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(2); ImGui::PopStyleColor();

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 wp = ImGui::GetWindowPos();

    // Subtle cyan glow at top
    dl->AddRectFilled({wp.x,wp.y},{wp.x+io.DisplaySize.x,wp.y+2.f},
        IM_COL32(0,195,225,200));
    // Bottom border
    dl->AddLine({wp.x, wp.y+HDR_H-1.f},{wp.x+io.DisplaySize.x, wp.y+HDR_H-1.f},
        IM_COL32(0,120,145,60), 1.f);

    // Logo — left side
    if (g_logoSRV) {
        const float ls = 52.f;
        float lx = 22.f, ly = (HDR_H - ls) * 0.5f;
        ImGui::SetCursorPos({lx, ly});
        ImGui::Image((ImTextureID)g_logoSRV, {ls, ls});
    }

    // Centred title block
    {
        ImGui::SetWindowFontScale(1.9f);
        float lineH = ImGui::GetTextLineHeight();
        ImGui::SetWindowFontScale(1.f);
        float subH  = ImGui::GetTextLineHeight();
        float totalH = lineH + 4.f + subH;
        float startY = (HDR_H - totalH) * 0.5f;

        // "EMINENCE TWEAK" — two-tone
        ImGui::SetWindowFontScale(1.9f);
        const char* t1 = "EMINENCE"; const char* t2 = " TWEAK";
        float w1 = ImGui::CalcTextSize(t1).x;
        float w2 = ImGui::CalcTextSize(t2).x;
        float cx = (io.DisplaySize.x - (w1+w2)) * 0.5f;
        ImGui::SetCursorPos({cx, startY});
        ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
        ImGui::Text("%s", t1);
        ImGui::PopStyleColor();
        ImGui::SameLine(0.f,0.f);
        ImGui::PushStyleColor(ImGuiCol_Text, C_ACC2);
        ImGui::Text("%s", t2);
        ImGui::PopStyleColor();
        ImGui::SetWindowFontScale(1.f);

        // Subtitle
        const char* sub = "GAMING PC OPTIMIZER";
        float sw = ImGui::CalcTextSize(sub).x;
        ImGui::SetCursorPos({(io.DisplaySize.x-sw)*0.5f, startY+lineH+4.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::Text("%s", sub);
        ImGui::PopStyleColor();
    }

    // Admin badge (below subtitle, centred-ish)
    {
        bool admin = IsAdmin();
        ImGui::PushStyleColor(ImGuiCol_Text, admin ? C_GREEN : C_ACCD);
        float aw = ImGui::CalcTextSize(admin?" ADMIN":"NO ADMIN").x;
        ImGui::SetCursorPos({18.f, HDR_H-22.f});
        ImGui::Text(admin ? " ADMIN" : "NO ADMIN");
        ImGui::PopStyleColor();
        ImGui::SetCursorPos({18.f+aw+10.f, HDR_H-22.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
        ImGui::Text("discord.gg/eminencehardware");
        ImGui::PopStyleColor();
    }

    // Window controls — top right
    const float btnW = 46.f;
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding,0.f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,{0,0});

    ImGui::SetCursorPos({io.DisplaySize.x - btnW*2.f, 0.f});
    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {1.f,1.f,1.f,0.07f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {1.f,1.f,1.f,0.12f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    if (ImGui::Button(" \xe2\x80\x94 ##mn",{btnW,HDR_H*0.45f})) ShowWindow(hwnd,SW_MINIMIZE);
    ImGui::PopStyleColor(4);

    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.62f,0.07f,0.07f,1.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {0.44f,0.04f,0.04f,1.f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    bool cls = ImGui::Button(" X ##cl",{btnW,HDR_H*0.45f});
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);

    ImGui::End();
    return cls;
}

// ─── Tab bar ─────────────────────────────────────────────────────────────
static void DrawTabBar() {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos({0.f, HDR_H});
    ImGui::SetNextWindowSize({io.DisplaySize.x, TAB_H});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.022f,0.020f,0.038f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{0.f,0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0.f);
    ImGui::Begin("##tabs",nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(2); ImGui::PopStyleColor();

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 wp = ImGui::GetWindowPos();

    const char* tabs[] = {"Tweaks","Undo Changes"};
    const float tabW   = 200.f;
    const float totalW = tabW * 2.f + 16.f;
    float startX = (io.DisplaySize.x - totalW) * 0.5f;

    for (int i = 0; i < 2; i++) {
        float tx = startX + i * (tabW + 16.f);
        ImVec2 tpos = {wp.x + tx, wp.y};
        bool active = (g_tab == i);
        bool hov = ImGui::IsMouseHoveringRect(tpos,{tpos.x+tabW, tpos.y+TAB_H});

        ImU32 tc = active ? IM_COL32(0,215,240,255)
                 : (hov   ? IM_COL32(160,215,225,255)
                          : IM_COL32(100,130,145,255));
        dl->AddText({tpos.x + (tabW - ImGui::CalcTextSize(tabs[i]).x)*0.5f,
                     tpos.y + (TAB_H - ImGui::GetTextLineHeight())*0.5f}, tc, tabs[i]);
        if (active)
            dl->AddRectFilled({tpos.x + 20.f, tpos.y+TAB_H-2.5f},
                              {tpos.x + tabW - 20.f, tpos.y+TAB_H},
                              IM_COL32(0,200,230,255), 2.f);
        if (hov && ImGui::IsMouseClicked(0)) g_tab = i;
    }

    // Bottom separator
    dl->AddLine({wp.x, wp.y+TAB_H-1.f},{wp.x+io.DisplaySize.x, wp.y+TAB_H-1.f},
        IM_COL32(0,100,120,55), 1.f);

    ImGui::End();
}

// ─── Main UI (no sidebar, EDGEY layout) ──────────────────────────────────
static void DrawMainUI(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();
    if (DrawHeader(hwnd)) g_wantClose = true;
    DrawTabBar();

    const float topY = HDR_H + TAB_H;
    float ctW = io.DisplaySize.x;
    float ctH = io.DisplaySize.y - topY;

    // Particles
    float dt = io.DeltaTime;
    if (!g_ptsInit) InitParticles(ctW, ctH);
    UpdateParticles(ctW, ctH, dt);

    ImGui::SetNextWindowPos({0.f, topY});
    ImGui::SetNextWindowSize({ctW, ctH});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {16.f,12.f});
    ImGui::Begin("##ct", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

    // Background: subtle dot grid + particles
    {
        ImDrawList* bdl = ImGui::GetWindowDrawList();
        ImVec2 wp = ImGui::GetWindowPos();
        for (float x = 0; x < ctW; x += 48.f)
            for (float y = 0; y < ctH; y += 48.f)
                bdl->AddCircleFilled({wp.x+x, wp.y+y}, 0.8f, IM_COL32(0,120,145,16));
        DrawParticles(bdl, wp, ctW, ctH);
    }

    bool busy = g_app.running.load();
    float prog = g_app.progress.load();

    // ── TWEAKS TAB ────────────────────────────────────────────────────────
    if (g_tab == 0) {
        // Scrollable button grid
        const float botH = 68.f; // bottom bar height
        float gridH = ImGui::GetContentRegionAvail().y - botH;
        ImGui::PushStyleColor(ImGuiCol_ChildBg, {0,0,0,0});
        ImGui::BeginChild("##grid", {-1.f, gridH}, false);
        ImGui::Dummy({0.f, 4.f});
        DrawAllTweaksGrid();
        ImGui::EndChild();
        ImGui::PopStyleColor();

        // Bottom bar: progress + OPTIMIZE ALL
        ImGui::Dummy({0.f, 6.f});

        // Progress bar
        {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            ImVec2 ps = ImGui::GetCursorScreenPos();
            float barW = io.DisplaySize.x - 32.f;
            dl->AddRectFilled(ps, {ps.x+barW, ps.y+3.f}, IM_COL32(0,40,50,220), 2.f);
            if (prog > 0.f)
                dl->AddRectFilledMultiColor(ps, {ps.x+barW*prog, ps.y+3.f},
                    IM_COL32(0,130,155,255), IM_COL32(0,205,235,255),
                    IM_COL32(0,205,235,255), IM_COL32(0,130,155,255));
            ImGui::Dummy({0.f, 8.f});
        }

        // Status + OPTIMIZE ALL
        ImGui::PushStyleColor(ImGuiCol_Text, busy ? C_ACC : C_DIM);
        ImGui::Text(busy ? "Running..." : "Ready");
        ImGui::PopStyleColor();
        ImGui::SameLine();
        float btnW2 = 180.f;
        ImGui::SetCursorPosX(ImGui::GetContentRegionAvail().x - btnW2 + 16.f);
        if (busy) ImGui::BeginDisabled();
        if (CardButton("##optall","OPTIMIZE ALL",{btnW2, 36.f}, busy)) {
            RunAsync([](){
                ApplyAllTweaks(g_app.progress, MakeLog());
                g_app.showRebootDlg = true;
            });
        }
        if (busy) ImGui::EndDisabled();
    }

    // ── UNDO CHANGES TAB ─────────────────────────────────────────────────
    else {
        ImGui::Dummy({0.f, 8.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::TextWrapped("Restore Windows defaults for key settings changed by Eminence Tweak.");
        ImGui::PopStyleColor();
        ImGui::Dummy({0.f, 14.f});

        float avail = ImGui::GetContentRegionAvail().x;
        float gap   = 8.f;
        float cw    = (avail - gap*2.f) / 3.f;
        float ch    = 48.f;

        struct UndoEntry { const char* name; const char* cmd; };
        static const UndoEntry undos[] = {
            {"Re-enable Windows Update",   "sc config wuauserv start= auto && net start wuauserv"},
            {"Re-enable Windows Defender", "sc config WinDefend start= auto && net start WinDefend"},
            {"Re-enable Hibernate",        "powercfg /h on"},
            {"Re-enable Xbox Game Bar",    "reg add \"HKCU\\SOFTWARE\\Microsoft\\GameBar\" /v ShowStartupPanel /t REG_DWORD /d 1 /f"},
            {"Re-enable Notifications",    "reg add \"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\" /v ToastEnabled /t REG_DWORD /d 1 /f"},
            {"Re-enable Telemetry",        "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection\" /v AllowTelemetry /t REG_DWORD /d 1 /f"},
            {"Restore USB Power-Saving",   "powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 1 && powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 1 && powercfg /apply"},
            {"Reset Power Plan",           "powercfg /restoredefaultschemes"},
            {"Re-enable Cortana",          "reg delete \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search\" /v AllowCortana /f"},
        };

        int col = 0;
        for (int i = 0; i < (int)(sizeof(undos)/sizeof(undos[0])); i++) {
            std::string id = "##u" + std::to_string(i);
            if (CardButton(id.c_str(), undos[i].name, {cw, ch}, busy)) {
                std::string cmd = undos[i].cmd;
                RunAsync([cmd](){
                    TweakGroup g; g.name = "Undo"; g.cmds.push_back(cmd);
                    std::atomic<float> p = 0.f;
                    ApplyTweakGroups({g}, p, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            col++;
            if (col < 3) ImGui::SameLine(0.f, gap);
            else { col = 0; ImGui::Dummy({0.f, 6.f}); }
        }
    }

    // Output log — always at bottom
    {
        ImGui::SetCursorPosY(ImGui::GetContentRegionMax().y - 138.f);
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
    }

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
            if (pt.y<(int)HDR_H && pt.x < (int)GetSystemMetrics(SM_CXSCREEN)-100)
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
