/*
 * ███████╗███╗   ███╗██╗███╗   ██╗███████╗███╗   ██╗ ██████╗███████╗
 * ██╔════╝████╗ ████║██║████╗  ██║██╔════╝████╗  ██║██╔════╝██╔════╝
 * █████╗  ██╔████╔██║██║██╔██╗ ██║█████╗  ██╔██╗ ██║██║     █████╗
 * ██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██║╚██╗██║██║     ██╔══╝
 * ███████╗██║ ╚═╝ ██║██║██║ ╚████║███████╗██║ ╚████║╚██████╗███████╗
 * ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
 *
 * Eminence Tweak  —  Gaming PC Optimizer v3.0
 * Red & Black  |  Cinematic loading  |  Ultra-clean UI
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
static int      g_section = 0; // 0=System 1=Network 2=GPU 3=Games 4=Cleanup

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
//  COLOUR PALETTE  —  red & black, ultra-clean
// ═══════════════════════════════════════════════════════════════════════════
// Background layers
static const ImVec4 C_BG      = {0.040f, 0.020f, 0.020f, 1.f}; // #0A0505
static const ImVec4 C_BG2     = {0.058f, 0.030f, 0.030f, 1.f}; // #0F0808
static const ImVec4 C_CARD    = {0.078f, 0.040f, 0.040f, 1.f}; // #140A0A
static const ImVec4 C_CARD_H  = {0.110f, 0.058f, 0.058f, 1.f}; // #1C0F0F
// Red accents
static const ImVec4 C_RED     = {0.820f, 0.080f, 0.080f, 1.f}; // #D11414
static const ImVec4 C_RED2    = {1.000f, 0.150f, 0.150f, 1.f}; // #FF2626
static const ImVec4 C_REDD    = {0.340f, 0.030f, 0.030f, 1.f}; // #570808
static const ImVec4 C_REDDD   = {0.160f, 0.015f, 0.015f, 1.f}; // #290404
// Text
static const ImVec4 C_TEXT    = {0.940f, 0.920f, 0.910f, 1.f}; // #F0EBE8
static const ImVec4 C_DIM     = {0.500f, 0.400f, 0.390f, 1.f}; // #806763
static const ImVec4 C_DIM2    = {0.270f, 0.200f, 0.195f, 1.f}; // #453332
// Status
static const ImVec4 C_GREEN   = {0.200f, 0.850f, 0.380f, 1.f}; // #33D961
static const ImVec4 C_BORDER  = {0.200f, 0.060f, 0.060f, 1.f}; // #330F0F

static ImU32 IC(ImVec4 v, float a = 1.f) {
    return IM_COL32((int)(v.x*255),(int)(v.y*255),(int)(v.z*255),(int)(v.w*a*255));
}

// ─── Theme ────────────────────────────────────────────────────────────────
static void ApplyTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding    = 0.f;
    s.ChildRounding     = 6.f;
    s.FrameRounding     = 5.f;
    s.GrabRounding      = 4.f;
    s.TabRounding       = 5.f;
    s.ScrollbarRounding = 5.f;
    s.PopupRounding     = 6.f;
    s.WindowBorderSize  = 0.f;
    s.FrameBorderSize   = 1.f;
    s.WindowPadding     = {18.f, 14.f};
    s.FramePadding      = {12.f, 7.f};
    s.ItemSpacing       = {10.f, 8.f};
    s.ScrollbarSize     = 8.f;

    auto* c = s.Colors;
    c[ImGuiCol_WindowBg]             = C_BG;
    c[ImGuiCol_ChildBg]              = C_BG2;
    c[ImGuiCol_PopupBg]              = C_BG2;
    c[ImGuiCol_FrameBg]              = C_CARD;
    c[ImGuiCol_FrameBgHovered]       = C_CARD_H;
    c[ImGuiCol_FrameBgActive]        = C_CARD_H;
    c[ImGuiCol_TitleBg]              = C_BG;
    c[ImGuiCol_TitleBgActive]        = C_BG;
    c[ImGuiCol_Button]               = C_CARD;
    c[ImGuiCol_ButtonHovered]        = C_CARD_H;
    c[ImGuiCol_ButtonActive]         = C_REDDD;
    c[ImGuiCol_Header]               = C_CARD;
    c[ImGuiCol_HeaderHovered]        = C_CARD_H;
    c[ImGuiCol_HeaderActive]         = C_REDDD;
    c[ImGuiCol_Tab]                  = C_BG2;
    c[ImGuiCol_TabHovered]           = C_CARD_H;
    c[ImGuiCol_TabActive]            = C_CARD;
    c[ImGuiCol_TabUnfocused]         = C_BG;
    c[ImGuiCol_TabUnfocusedActive]   = C_BG2;
    c[ImGuiCol_ScrollbarBg]          = C_BG;
    c[ImGuiCol_ScrollbarGrab]        = C_REDD;
    c[ImGuiCol_ScrollbarGrabHovered] = C_RED;
    c[ImGuiCol_ScrollbarGrabActive]  = C_RED2;
    c[ImGuiCol_SliderGrab]           = C_RED;
    c[ImGuiCol_SliderGrabActive]     = C_RED2;
    c[ImGuiCol_CheckMark]            = C_RED2;
    c[ImGuiCol_Separator]            = C_BORDER;
    c[ImGuiCol_SeparatorHovered]     = C_REDD;
    c[ImGuiCol_SeparatorActive]      = C_RED;
    c[ImGuiCol_Border]               = C_BORDER;
    c[ImGuiCol_BorderShadow]         = {0,0,0,0};
    c[ImGuiCol_Text]                 = C_TEXT;
    c[ImGuiCol_TextDisabled]         = C_DIM;
    c[ImGuiCol_TextSelectedBg]       = C_REDDD;
    c[ImGuiCol_PlotHistogram]        = C_RED;
    c[ImGuiCol_PlotHistogramHovered] = C_RED2;
    c[ImGuiCol_ResizeGrip]           = C_REDD;
    c[ImGuiCol_ResizeGripHovered]    = C_RED;
    c[ImGuiCol_ResizeGripActive]     = C_RED2;
    c[ImGuiCol_NavHighlight]         = C_RED;
    c[ImGuiCol_ModalWindowDimBg]     = {0,0,0,0.75f};
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
static bool RedButton(const char* label, ImVec2 sz = {0,0}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        C_CARD);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, C_CARD_H);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  C_REDDD);
    ImGui::PushStyleColor(ImGuiCol_Border,        C_REDD);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.f);
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(4);
    if (ImGui::IsItemHovered()) {
        auto rMin = ImGui::GetItemRectMin();
        auto rMax = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(rMin, rMax, IC(C_RED, 0.7f), 5.f, 0, 1.5f);
    }
    return hit;
}

static bool PrimaryButton(const char* label, ImVec2 sz = {0,0}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.48f,0.05f,0.05f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.70f,0.08f,0.08f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.35f,0.03f,0.03f,1.f));
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXT);
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleColor(4);
    if (ImGui::IsItemHovered()) {
        float t = (float)ImGui::GetTime();
        float p = 0.5f + 0.5f * sinf(t * 3.5f);
        auto rMin = ImGui::GetItemRectMin();
        auto rMax = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(rMin, rMax, IC(C_RED2, p * 0.7f), 5.f, 0, 2.f);
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
        dl->AddLine(p0, p1, IM_COL32(210,20,20,(ImU8)(alpha*230)), thick);
    }
    float ta = t*spd + arc*IM_PI*2.f;
    ImVec2 tip = {C.x+cosf(ta)*r, C.y+sinf(ta)*r};
    dl->AddCircleFilled(tip, thick*1.6f, IM_COL32(255,60,60,255));
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
    ImVec2 C = {io.DisplaySize.x*0.5f, io.DisplaySize.y*0.5f};

    // Subtle background grid
    for (int x = 0; x < (int)io.DisplaySize.x; x += 50)
        for (int y = 0; y < (int)io.DisplaySize.y; y += 50)
            dl->AddCircleFilled({(float)x,(float)y}, 1.f, IM_COL32(60,10,10,35));

    // Glow aura
    for (int i = 3; i >= 0; i--) {
        float r = 80.f + i*28.f;
        float pulse = 0.3f + 0.2f*sinf(t*1.1f + i*0.6f);
        dl->AddCircle({C.x,C.y}, r, IM_COL32(180,20,20,(int)(pulse*55)), 72, 1.f);
    }

    // Double spinner
    DrawSpinner(dl, C, 66.f, 3.f, t);
    DrawSpinner(dl, C, 48.f, 1.6f, -t*0.65f);

    // Pulsing center
    float dp = 0.6f + 0.4f*sinf(t*4.5f);
    dl->AddCircleFilled({C.x,C.y}, 5.f*dp, IM_COL32(220,30,30,255));
    dl->AddCircleFilled({C.x,C.y}, 14.f*dp, IM_COL32(180,20,20,50));

    // ── Logo ──────────────────────────────────────────────────────────────
    if (g_logoSRV) {
        const float logoSize = 110.f;
        ImGui::SetCursorPos({C.x - logoSize * 0.5f, C.y - 200.f});
        ImGui::Image((ImTextureID)g_logoSRV, {logoSize, logoSize});
        ImGui::SetCursorPos({C.x - 128.f, C.y - 80.f});
    } else {
        ImGui::SetCursorPos({C.x-128.f, C.y-168.f});
    }
    ImGui::SetWindowFontScale(2.4f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_RED2);
    ImGui::Text("EMINENCE");
    ImGui::PopStyleColor();
    float titleCurY = g_logoSRV ? C.y - 46.f : C.y - 134.f;
    ImGui::SetCursorPos({C.x-128.f, titleCurY});
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
    ImGui::Text("TWEAK");
    ImGui::PopStyleColor();
    ImGui::SetWindowFontScale(1.f);

    // Subtitle
    const char* sub = "GAMING PC OPTIMIZER  \xe2\x80\x94  v3.0";
    float subW = ImGui::CalcTextSize(sub).x;
    ImGui::SetCursorPos({C.x - subW*0.5f, C.y - 102.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
    ImGui::Text("%s", sub);
    ImGui::PopStyleColor();

    // Thin separator lines flanking subtitle
    float lineY = C.y - 92.f;
    dl->AddLine({C.x - 200.f, lineY}, {C.x - subW*0.5f - 10.f, lineY}, IC(C_BORDER,0.8f), 0.8f);
    dl->AddLine({C.x + subW*0.5f + 10.f, lineY}, {C.x + 200.f, lineY}, IC(C_BORDER,0.8f), 0.8f);

    // ── Progress bar ──────────────────────────────────────────────────────
    float bW = 320.f, bH = 3.f;
    float bX = C.x - bW*0.5f, bY = C.y + 108.f;
    dl->AddRectFilled({bX,bY},{bX+bW,bY+bH}, IM_COL32(30,8,8,255), bH);
    if (prog > 0.f) {
        dl->AddRectFilled({bX,bY},{bX+bW*prog,bY+bH}, IM_COL32(205,25,25,255), bH);
        float tx = bX + bW*prog;
        dl->AddCircleFilled({tx,bY+bH*0.5f}, 6.f, IM_COL32(220,30,30,60));
        dl->AddCircleFilled({tx,bY+bH*0.5f}, 3.f, IM_COL32(255,70,70,255));
    }

    // Status message
    int mi = std::min((int)(prog*kLoadMsgCount), kLoadMsgCount-1);
    float mW = ImGui::CalcTextSize(kLoadMsgs[mi]).x;
    ImGui::SetCursorPos({C.x-mW*0.5f, C.y+118.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
    ImGui::Text("%s", kLoadMsgs[mi]);
    ImGui::PopStyleColor();

    // Percent
    char pct[10]; snprintf(pct,sizeof(pct),"%.0f%%",prog*100.f);
    float pW = ImGui::CalcTextSize(pct).x;
    ImGui::SetCursorPos({C.x-pW*0.5f, C.y+138.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_RED);
    ImGui::Text("%s",pct);
    ImGui::PopStyleColor();

    // Bottom discord
    ImGui::SetCursorPos({18.f, io.DisplaySize.y-26.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_BORDER);
    ImGui::Text("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    ImGui::End();
    if (g_loadTimer >= LOAD_DURATION) g_phase = AppPhase::Main;
}

// ─── Log panel ────────────────────────────────────────────────────────────
static void DrawLog(float h) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.025f,0.010f,0.010f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.f);
    if (ImGui::BeginChild("##log",{-1.f,h},true,ImGuiWindowFlags_HorizontalScrollbar)) {
        std::lock_guard<std::mutex> lk(g_app.logMutex);
        ImGuiListClipper clipper;
        clipper.Begin((int)g_app.logLines.size());
        while (clipper.Step())
            for (int i=clipper.DisplayStart; i<clipper.DisplayEnd; i++) {
                auto& [txt,ok] = g_app.logLines[i];
                bool hdr = txt.find("====")!=std::string::npos || txt.find(">> ")!=std::string::npos;
                ImVec4 col = hdr ? C_RED : (ok ? C_GREEN : C_DIM);
                ImGui::TextColored(col, "%s", txt.c_str());
            }
        if (g_app.scrollToBottom) { ImGui::SetScrollHereY(1.f); g_app.scrollToBottom=false; }
        ImGui::EndChild();
    }
    ImGui::PopStyleVar(); ImGui::PopStyleColor();
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────
static bool NavItem(const char* label, bool active, float w) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 pos     = ImGui::GetCursorScreenPos();
    const float h  = 42.f;
    ImGui::InvisibleButton(label, {w, h});
    bool hov     = ImGui::IsItemHovered();
    bool clicked = ImGui::IsItemClicked();
    if (active || hov) {
        ImU32 bg = active ? IM_COL32(26,8,8,255) : IM_COL32(15,5,5,255);
        dl->AddRectFilled(pos, {pos.x+w, pos.y+h}, bg);
    }
    if (active)
        dl->AddRectFilled({pos.x, pos.y+8.f}, {pos.x+3.f, pos.y+h-8.f}, IC(C_RED));
    else if (hov)
        dl->AddRectFilled({pos.x, pos.y+10.f}, {pos.x+2.f, pos.y+h-10.f}, IC(C_REDD));
    ImVec2 tsz = ImGui::CalcTextSize(label);
    ImU32 tc = active ? ImGui::ColorConvertFloat4ToU32(C_TEXT)
             : (hov   ? IM_COL32(200,175,172,255)
                      : ImGui::ColorConvertFloat4ToU32(C_DIM));
    dl->AddText({pos.x+16.f, pos.y+(h-tsz.y)*0.5f}, tc, label);
    return clicked;
}

// ─── Clean card button ────────────────────────────────────────────────────
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
    float a   = disabled ? 0.42f : 1.f;
    ImU32 bg  = hov ? IM_COL32(28,14,14,255) : IM_COL32(16,8,8,(int)(255*a));
    ImU32 acc = hov ? IM_COL32(255,45,45,255) : IM_COL32(80,8,8,(int)(255*a));
    ImU32 tc  = disabled ? IM_COL32(100,75,73,160)
              : (hov     ? IM_COL32(240,235,232,255)
                         : IM_COL32(196,185,182,255));
    dl->AddRectFilled(pos, {pos.x+sz.x, pos.y+sz.y}, bg, 5.f);
    dl->AddRectFilled(pos, {pos.x+3.f,  pos.y+sz.y}, acc, 3.f);
    ImVec2 tsz = ImGui::CalcTextSize(label);
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
        ImGui::TextColored(C_RED2,"  All tweaks have been applied!");
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
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.022f,0.010f,0.010f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{16.f,0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0.f);
    ImGui::Begin("##tb",nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(2); ImGui::PopStyleColor();

    // Logo
    float textY = (H - ImGui::GetTextLineHeight()*1.5f)*0.5f;
    float curX = 16.f;
    if (g_logoSRV) {
        const float icoSize = 30.f;
        ImGui::SetCursorPos({curX, (H - icoSize) * 0.5f});
        ImGui::Image((ImTextureID)g_logoSRV, {icoSize, icoSize});
        ImGui::SameLine(0.f, 8.f);
        curX = ImGui::GetCursorPosX();
    }
    ImGui::SetCursorPos({curX, textY});
    ImGui::SetWindowFontScale(1.25f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_RED2);
    ImGui::Text("EMINENCE");
    ImGui::PopStyleColor();
    ImGui::SameLine(0.f,6.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
    ImGui::Text("TWEAK");
    ImGui::PopStyleColor();
    ImGui::SetWindowFontScale(1.f);
    ImGui::SameLine(0.f,8.f);
    ImGui::SetCursorPosY((H-ImGui::GetTextLineHeight())*0.5f+1.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::Text("v3.0");
    ImGui::PopStyleColor();

    // Admin badge
    bool admin = IsAdmin();
    ImGui::SameLine(0.f,20.f);
    ImGui::SetCursorPosY((H-ImGui::GetFrameHeight())*0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, admin ? C_GREEN : C_RED);
    ImGui::Text(admin ? " ADMIN" : " NO ADMIN");
    ImGui::PopStyleColor();

    // Discord
    ImGui::SameLine(0.f,18.f);
    ImGui::SetCursorPosY((H-ImGui::GetTextLineHeight())*0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_REDD);
    ImGui::Text("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    // Window controls
    float ctrlW = 90.f;
    ImGui::SetCursorPos({io.DisplaySize.x-ctrlW, 0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding,0.f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,{0,0});

    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {1,1,1,0.07f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {1,1,1,0.12f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    if (ImGui::Button(" \xe2\x80\x94 ##mn",{45.f,H})) ShowWindow(hwnd,SW_MINIMIZE);
    ImGui::PopStyleColor(4);

    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Button,        {0,0,0,0});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.7f,0.07f,0.07f,1.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {0.5f,0.04f,0.04f,1.f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_DIM);
    bool cls = ImGui::Button(" X ##cl",{45.f,H});
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);

    // Bottom hairline
    ImVec2 wp = ImGui::GetWindowPos();
    ImGui::GetWindowDrawList()->AddLine(
        {wp.x, wp.y+H-1.f}, {wp.x+io.DisplaySize.x, wp.y+H-1.f},
        IC(C_BORDER,0.9f), 1.f);

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
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.016f,0.007f,0.007f,1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0.f,0.f});
    ImGui::Begin("##sb", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse|
        ImGuiWindowFlags_NoBringToFrontOnFocus|ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

    ImDrawList* sdl = ImGui::GetWindowDrawList();
    ImVec2 sbWP = ImGui::GetWindowPos();
    sdl->AddLine({sbWP.x+SBW-1.f, sbWP.y}, {sbWP.x+SBW-1.f, sbWP.y+sbH}, IC(C_BORDER,0.9f));

    // Logo
    ImGui::Dummy({0.f, 14.f});
    if (g_logoSRV) {
        const float ls = 38.f;
        ImGui::SetCursorPosX((SBW - ls) * 0.5f);
        ImGui::Image((ImTextureID)g_logoSRV, {ls, ls});
        ImGui::Dummy({0.f, 8.f});
    } else {
        ImGui::Dummy({0.f, 6.f});
    }

    // Separator line under logo
    float sepY = sbWP.y + ImGui::GetCursorPosY();
    sdl->AddLine({sbWP.x+12.f, sepY}, {sbWP.x+SBW-13.f, sepY}, IC(C_BORDER,0.55f));
    ImGui::Dummy({0.f, 6.f});

    // Nav items
    const char* sections[] = {"System","Network","GPU","Cleanup"};
    for (int i = 0; i < 4; i++) {
        ImGui::SetCursorPosX(0.f);
        if (NavItem(sections[i], g_section==i, SBW-1.f)) g_section = i;
    }

    // Bottom fixed layout
    bool busy = g_app.running.load();
    float prog = g_app.progress.load();

    // Status text
    ImGui::SetCursorPos({10.f, sbH - 102.f});
    ImGui::PushStyleColor(ImGuiCol_Text, busy ? C_RED : C_DIM2);
    ImGui::TextUnformatted(busy ? "Running..." : "Ready");
    ImGui::PopStyleColor();

    // Progress bar (3px thin, drawn via DrawList)
    float pbY = sbWP.y + sbH - 82.f;
    sdl->AddRectFilled({sbWP.x+10.f, pbY}, {sbWP.x+SBW-11.f, pbY+3.f}, IM_COL32(18,6,6,255), 2.f);
    if (prog > 0.f) {
        sdl->AddRectFilled({sbWP.x+10.f, pbY},
            {sbWP.x+10.f+(SBW-21.f)*prog, pbY+3.f}, IM_COL32(205,25,25,255), 2.f);
    }

    // OPTIMIZE ALL button
    ImGui::SetCursorPos({8.f, sbH - 76.f});
    if (busy) ImGui::BeginDisabled();
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.52f,0.05f,0.05f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.72f,0.08f,0.08f,1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.36f,0.03f,0.03f,1.f));
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXT);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 5.f);
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
        ImGui::GetWindowDrawList()->AddRect(rm, rM, IC(C_RED2, p2), 5.f, 0, 2.f);
    }

    // Discord link
    ImGui::SetCursorPos({10.f, sbH - 22.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_DIM2);
    ImGui::TextUnformatted("discord.gg/eminencehardware");
    ImGui::PopStyleColor();

    ImGui::End();

    // ══ CONTENT AREA ══════════════════════════════════════════════════════
    ImGui::SetNextWindowPos({SBW, TB});
    ImGui::SetNextWindowSize({io.DisplaySize.x-SBW, io.DisplaySize.y-TB});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {14.f,10.f});
    ImGui::Begin("##ct", nullptr,
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|ImGuiWindowFlags_NoMove|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoBringToFrontOnFocus|
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

    // Section header
    const char* titles[] = {
        "System Tweaks","Network Tweaks","GPU / Driver Tweaks","Cleanup"
    };
    ImGui::Dummy({0.f,4.f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_RED);
    ImGui::SetWindowFontScale(1.12f);
    ImGui::Text("%s", titles[g_section]);
    ImGui::SetWindowFontScale(1.f);
    ImGui::PopStyleColor();
    ImGui::Dummy({0.f,6.f});

    // Scrollable cards area
    const float logH    = 155.f;
    float       cardAreaH = ImGui::GetContentRegionAvail().y - logH - 20.f;
    ImGui::PushStyleColor(ImGuiCol_ChildBg, C_BG);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 0.f);
    ImGui::BeginChild("##ca", {-1.f, cardAreaH}, false);
    if      (g_section == 0) DrawCleanGrid(g_systemTweaks);
    else if (g_section == 1) DrawCleanGrid(g_networkTweaks);
    else if (g_section == 2) DrawCleanGrid(g_gpuTweaks);
    else {
        ImGui::Dummy({0.f,8.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::TextWrapped("Removes temporary files to free up disk space and improve load times.");
        ImGui::PopStyleColor();
        ImGui::Dummy({0.f,14.f});
        if (CardButton("##cln", "  Clean Temp Files", {220.f,50.f}, busy))
            RunAsync([](){CleanTempFiles(g_app.progress, MakeLog());});
        ImGui::Dummy({0.f,14.f});
        ImGui::PushStyleColor(ImGuiCol_Text, C_DIM);
        ImGui::TextUnformatted("Targets:");
        ImGui::PopStyleColor();
        const char* flds[] = {"%TEMP%","C:\\Windows\\Temp",
                              "C:\\Windows\\Prefetch","%LOCALAPPDATA%\\Temp"};
        for (auto f : flds) {
            ImGui::PushStyleColor(ImGuiCol_Text, C_REDD);
            ImGui::Text("  * %s", f);
            ImGui::PopStyleColor();
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleVar(); ImGui::PopStyleColor();

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

    constexpr float CLEAR[4] = {0.040f,0.020f,0.020f,1.f};

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
