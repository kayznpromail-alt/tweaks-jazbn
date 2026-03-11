/*
 * ███████╗███╗   ███╗██╗███╗   ██╗███████╗███╗   ██╗ ██████╗███████╗
 * ██╔════╝████╗ ████║██║████╗  ██║██╔════╝████╗  ██║██╔════╝██╔════╝
 * █████╗  ██╔████╔██║██║██╔██╗ ██║█████╗  ██╔██╗ ██║██║     █████╗
 * ██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██║╚██╗██║██║     ██╔══╝
 * ███████╗██║ ╚═╝ ██║██║██║ ╚████║███████╗██║ ╚████║╚██████╗███████╗
 * ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
 *
 * Eminence Tweak  —  Gaming PC Optimizer v3.0
 * Cinematic cyan UI  |  Loading screen  |  Grid layout
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

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")

#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"

#include "tweaks.h"

// ─── D3D11 globals ────────────────────────────────────────────────────────
static ID3D11Device*            g_pd3dDevice           = nullptr;
static ID3D11DeviceContext*     g_pd3dDeviceContext    = nullptr;
static IDXGISwapChain*          g_pSwapChain           = nullptr;
static UINT                     g_ResizeWidth          = 0;
static UINT                     g_ResizeHeight         = 0;
static ID3D11RenderTargetView*  g_mainRenderTargetView = nullptr;

// ─── App phase ────────────────────────────────────────────────────────────
enum class AppPhase { Loading, Main };
static AppPhase g_phase     = AppPhase::Loading;
static float    g_loadTimer = 0.f;
static bool     g_wantClose = false;

static const float LOAD_DURATION = 3.2f;
static const char* kLoadMessages[] = {
    "Initializing DirectX 11...",
    "Loading system profiles...",
    "Scanning registry keys...",
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
        time_t t = time(nullptr);
        tm tm_{}; localtime_s(&tm_, &t);
        char ts[12]; strftime(ts, sizeof(ts), "%H:%M:%S", &tm_);
        logLines.push_back({ std::string("[") + ts + "]  " + msg, ok });
        if (logLines.size() > 2000) logLines.erase(logLines.begin());
        scrollToBottom = true;
    }

    void clearLog() {
        std::lock_guard<std::mutex> lk(logMutex);
        logLines.clear();
    }
};
static AppState g_app;

// ─── D3D11 forward decls ─────────────────────────────────────────────────
static bool CreateDeviceD3D(HWND hWnd);
static void CleanupDeviceD3D();
static void CreateRenderTarget();
static void CleanupRenderTarget();
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(
    HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

// ─── Admin check ──────────────────────────────────────────────────────────
static bool IsAdmin() {
    BOOL result = FALSE;
    PSID adminGroup = nullptr;
    SID_IDENTIFIER_AUTHORITY ntAuth = SECURITY_NT_AUTHORITY;
    if (AllocateAndInitializeSid(&ntAuth, 2,
        SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS,
        0, 0, 0, 0, 0, 0, &adminGroup))
    {
        CheckTokenMembership(nullptr, adminGroup, &result);
        FreeSid(adminGroup);
    }
    return result == TRUE;
}

// ─── Color palette ────────────────────────────────────────────────────────
static const ImVec4 C_BG       = {0.027f, 0.035f, 0.063f, 1.f};  // deep navy
static const ImVec4 C_BG2      = {0.043f, 0.059f, 0.102f, 1.f};  // navy 2
static const ImVec4 C_CARD     = {0.059f, 0.082f, 0.145f, 1.f};  // card bg
static const ImVec4 C_CARD_H   = {0.078f, 0.118f, 0.208f, 1.f};  // card hover
static const ImVec4 C_ACCENT   = {0.000f, 0.820f, 1.000f, 1.f};  // electric cyan
static const ImVec4 C_ACCENT2  = {0.000f, 0.580f, 0.780f, 1.f};  // cyan dim
static const ImVec4 C_ACCENTD  = {0.000f, 0.310f, 0.430f, 1.f};  // cyan very dim
static const ImVec4 C_TEXT     = {0.878f, 0.949f, 0.996f, 1.f};  // near white
static const ImVec4 C_TEXTDIM  = {0.424f, 0.592f, 0.714f, 1.f};  // blue-gray
static const ImVec4 C_GREEN    = {0.078f, 0.953f, 0.529f, 1.f};  // bright green
static const ImVec4 C_RED      = {1.000f, 0.259f, 0.259f, 1.f};  // red
static const ImVec4 C_BORDER   = {0.102f, 0.188f, 0.298f, 1.f};  // border

static ImU32 ICOLOR(ImVec4 v, float a = 1.f) {
    return IM_COL32(
        (int)(v.x * 255), (int)(v.y * 255),
        (int)(v.z * 255), (int)(v.w * a * 255));
}

// ─── Theme ────────────────────────────────────────────────────────────────
static void ApplyTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding    = 10.f;
    s.ChildRounding     = 8.f;
    s.FrameRounding     = 7.f;
    s.GrabRounding      = 6.f;
    s.TabRounding       = 7.f;
    s.ScrollbarRounding = 8.f;
    s.PopupRounding     = 8.f;
    s.WindowBorderSize  = 0.f;
    s.FrameBorderSize   = 1.f;
    s.TabBorderSize     = 0.f;
    s.WindowPadding     = ImVec2(16.f, 14.f);
    s.FramePadding      = ImVec2(12.f, 7.f);
    s.ItemSpacing       = ImVec2(10.f, 8.f);
    s.ItemInnerSpacing  = ImVec2(7.f, 5.f);
    s.ScrollbarSize     = 10.f;

    auto* c = s.Colors;
    c[ImGuiCol_WindowBg]          = C_BG;
    c[ImGuiCol_ChildBg]           = C_BG2;
    c[ImGuiCol_PopupBg]           = C_BG2;
    c[ImGuiCol_FrameBg]           = C_CARD;
    c[ImGuiCol_FrameBgHovered]    = C_CARD_H;
    c[ImGuiCol_FrameBgActive]     = C_CARD_H;
    c[ImGuiCol_TitleBg]           = C_BG;
    c[ImGuiCol_TitleBgActive]     = C_BG;
    c[ImGuiCol_TitleBgCollapsed]  = C_BG;
    c[ImGuiCol_Button]            = C_CARD;
    c[ImGuiCol_ButtonHovered]     = C_CARD_H;
    c[ImGuiCol_ButtonActive]      = C_ACCENTD;
    c[ImGuiCol_Header]            = C_CARD;
    c[ImGuiCol_HeaderHovered]     = C_CARD_H;
    c[ImGuiCol_HeaderActive]      = C_ACCENTD;
    c[ImGuiCol_Tab]               = C_BG2;
    c[ImGuiCol_TabHovered]        = C_CARD_H;
    c[ImGuiCol_TabActive]         = C_CARD;
    c[ImGuiCol_TabUnfocused]      = C_BG;
    c[ImGuiCol_TabUnfocusedActive]= C_BG2;
    c[ImGuiCol_ScrollbarBg]       = C_BG;
    c[ImGuiCol_ScrollbarGrab]     = C_ACCENTD;
    c[ImGuiCol_ScrollbarGrabHovered] = C_ACCENT2;
    c[ImGuiCol_ScrollbarGrabActive]  = C_ACCENT;
    c[ImGuiCol_SliderGrab]        = C_ACCENT2;
    c[ImGuiCol_SliderGrabActive]  = C_ACCENT;
    c[ImGuiCol_CheckMark]         = C_ACCENT;
    c[ImGuiCol_Separator]         = C_BORDER;
    c[ImGuiCol_SeparatorHovered]  = C_ACCENT2;
    c[ImGuiCol_SeparatorActive]   = C_ACCENT;
    c[ImGuiCol_Border]            = C_BORDER;
    c[ImGuiCol_BorderShadow]      = {0.f, 0.f, 0.f, 0.f};
    c[ImGuiCol_Text]              = C_TEXT;
    c[ImGuiCol_TextDisabled]      = C_TEXTDIM;
    c[ImGuiCol_TextSelectedBg]    = C_ACCENTD;
    c[ImGuiCol_PlotHistogram]     = C_ACCENT;
    c[ImGuiCol_PlotHistogramHovered] = C_ACCENT2;
    c[ImGuiCol_ResizeGrip]        = C_ACCENTD;
    c[ImGuiCol_ResizeGripHovered] = C_ACCENT2;
    c[ImGuiCol_ResizeGripActive]  = C_ACCENT;
    c[ImGuiCol_NavHighlight]      = C_ACCENT;
    c[ImGuiCol_ModalWindowDimBg]  = {0.f, 0.f, 0.f, 0.70f};
    c[ImGuiCol_MenuBarBg]         = C_BG;
}

// ─── Async runner ─────────────────────────────────────────────────────────
template<typename Fn>
static void RunAsync(Fn&& fn) {
    if (g_app.running.load()) return;
    g_app.running.store(true);
    g_app.progress.store(0.f);
    g_app.clearLog();
    std::thread([fn = std::forward<Fn>(fn)]() mutable {
        fn();
        g_app.running.store(false);
    }).detach();
}

static LogCallback MakeLog() {
    return [](const std::string& msg, bool ok) { g_app.addLog(msg, ok); };
}

// ─── UI helpers ───────────────────────────────────────────────────────────
// Glowing cyan button — main style
static bool CyanButton(const char* label, ImVec2 sz = {0.f, 0.f}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        C_CARD);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, C_CARD_H);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  C_ACCENTD);
    ImGui::PushStyleColor(ImGuiCol_Border,        C_ACCENT2);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.f);
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(4);

    // Draw glow on hovered
    if (ImGui::IsItemHovered()) {
        ImVec2 rMin = ImGui::GetItemRectMin();
        ImVec2 rMax = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddRect(
            rMin, rMax, ICOLOR(C_ACCENT, 0.6f), 7.f, 0, 1.5f);
    }
    return hit;
}

// Large accent button (Apply All)
static bool AccentButton(const char* label, ImVec2 sz = {0.f, 0.f}) {
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.f, 0.38f, 0.52f, 1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.f, 0.52f, 0.72f, 1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.f, 0.28f, 0.40f, 1.f));
    ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(1.f, 1.f, 1.f, 1.f));
    bool hit = ImGui::Button(label, sz);
    ImGui::PopStyleColor(4);
    if (ImGui::IsItemHovered()) {
        ImVec2 rMin = ImGui::GetItemRectMin();
        ImVec2 rMax = ImGui::GetItemRectMax();
        float t = (float)ImGui::GetTime();
        float pulse = 0.55f + 0.45f * sinf(t * 3.f);
        ImGui::GetWindowDrawList()->AddRect(
            rMin, rMax, ICOLOR(C_ACCENT, pulse), 7.f, 0, 2.f);
    }
    return hit;
}

// ─── Loading screen ───────────────────────────────────────────────────────
static void DrawSpinner(ImDrawList* dl, ImVec2 center, float radius,
                        float thickness, float time)
{
    const int N = 60;
    const float arcFrac = 0.55f;
    const float speed   = 2.2f;
    for (int i = 0; i < (int)(N * arcFrac); i++) {
        float a0 = time * speed + (float)i        / N * IM_PI * 2.f;
        float a1 = time * speed + (float)(i + 1)  / N * IM_PI * 2.f;
        float alpha = (float)i / (N * arcFrac);
        ImVec2 p0 = { center.x + cosf(a0) * radius, center.y + sinf(a0) * radius };
        ImVec2 p1 = { center.x + cosf(a1) * radius, center.y + sinf(a1) * radius };
        dl->AddLine(p0, p1, IM_COL32(0, 209, 255, (ImU8)(alpha * 220)), thickness);
    }
    // Bright tip
    float tipA = time * speed + arcFrac * IM_PI * 2.f;
    ImVec2 tip = { center.x + cosf(tipA) * radius, center.y + sinf(tipA) * radius };
    dl->AddCircleFilled(tip, thickness * 1.4f, IM_COL32(0, 209, 255, 255));
}

static void DrawLoadingScreen() {
    ImGuiIO& io    = ImGui::GetIO();
    float    t     = (float)ImGui::GetTime();
    float    prog  = std::min(g_loadTimer / LOAD_DURATION, 1.f);

    ImGui::SetNextWindowPos({0, 0});
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0.f, 0.f});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::Begin("##splash", nullptr,
        ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 C = { io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f };

    // Background grid dots
    for (int x = 0; x < (int)io.DisplaySize.x; x += 40)
        for (int y = 0; y < (int)io.DisplaySize.y; y += 40)
            dl->AddCircleFilled({(float)x, (float)y}, 1.f,
                IM_COL32(20, 50, 100, 60));

    // Outer glow rings
    for (int i = 0; i < 4; i++) {
        float r = 100.f + i * 30.f;
        float pulse = 0.4f + 0.3f * sinf(t * 1.2f + i * 0.7f);
        dl->AddCircle({C.x, C.y}, r,
            IM_COL32(0, 180, 255, (int)(pulse * 60)), 80, 1.2f);
    }

    // Spinner rings
    DrawSpinner(dl, C, 68.f, 3.0f, t);
    DrawSpinner(dl, C, 52.f, 1.8f, -t * 0.7f);

    // Center dot
    float dpulse = 0.7f + 0.3f * sinf(t * 4.f);
    dl->AddCircleFilled(C, 6.f * dpulse, IM_COL32(0, 209, 255, 255));
    dl->AddCircleFilled(C, 12.f * dpulse, IM_COL32(0, 180, 255, 60));

    // ── Logo text ─────────────────────────────────────────────────────────
    ImGui::SetCursorPos({ C.x - 130.f, C.y - 160.f });

    ImGui::PushStyleColor(ImGuiCol_Text, C_ACCENT);
    ImGui::SetWindowFontScale(2.2f);
    ImGui::Text("EMINENCE");
    ImGui::PopStyleColor();

    ImGui::SetCursorPos({ C.x - 130.f, C.y - 130.f });
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
    ImGui::Text("TWEAK");
    ImGui::PopStyleColor();

    ImGui::SetWindowFontScale(1.f);
    ImGui::SetCursorPos({ C.x - 108.f, C.y - 100.f });
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXTDIM);
    ImGui::Text("GAMING PC OPTIMIZER  v3.0");
    ImGui::PopStyleColor();

    // ── Progress bar ──────────────────────────────────────────────────────
    float barW = 340.f, barH = 5.f;
    float barX = C.x - barW * 0.5f;
    float barY = C.y + 100.f;

    // Track
    dl->AddRectFilled({barX, barY}, {barX + barW, barY + barH},
        IM_COL32(15, 35, 70, 255), barH * 0.5f);
    // Fill
    if (prog > 0.f) {
        dl->AddRectFilled({barX, barY}, {barX + barW * prog, barY + barH},
            IM_COL32(0, 209, 255, 255), barH * 0.5f);
        // Glow tip
        float tipX = barX + barW * prog;
        dl->AddCircleFilled({tipX, barY + barH * 0.5f}, 8.f,
            IM_COL32(0, 209, 255, 80));
        dl->AddCircleFilled({tipX, barY + barH * 0.5f}, 4.f,
            IM_COL32(0, 209, 255, 220));
    }

    // ── Status message ────────────────────────────────────────────────────
    int msgIdx = std::min((int)(prog * kLoadMsgCount), kLoadMsgCount - 1);
    const char* msg = kLoadMessages[msgIdx];
    float msgW = ImGui::CalcTextSize(msg).x;

    ImGui::SetCursorPos({ C.x - msgW * 0.5f, C.y + 118.f });
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXTDIM);
    ImGui::Text("%s", msg);
    ImGui::PopStyleColor();

    // ── Percentage ────────────────────────────────────────────────────────
    char pct[12]; snprintf(pct, sizeof(pct), "%.0f%%", prog * 100.f);
    float pctW = ImGui::CalcTextSize(pct).x;
    ImGui::SetCursorPos({ C.x - pctW * 0.5f, C.y + 138.f });
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACCENT);
    ImGui::Text("%s", pct);
    ImGui::PopStyleColor();

    // ── Bottom branding ───────────────────────────────────────────────────
    ImGui::SetCursorPos({ 20.f, io.DisplaySize.y - 28.f });
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACCENTD);
    ImGui::Text("discord.gg/eminence");
    ImGui::PopStyleColor();

    ImGui::End();

    if (g_loadTimer >= LOAD_DURATION)
        g_phase = AppPhase::Main;
}

// ─── 3-column tweak grid ──────────────────────────────────────────────────
static void DrawTweakGrid(const std::vector<TweakGroup>& groups, float btnH = 44.f) {
    float avail = ImGui::GetContentRegionAvail().x;
    float gap   = 8.f;
    float btnW  = (avail - gap * 2.f) / 3.f;

    int col = 0;
    for (size_t i = 0; i < groups.size(); i++) {
        const auto& g = groups[i];

        bool busy = g_app.running.load();
        if (busy) ImGui::BeginDisabled();

        if (CyanButton(g.name.c_str(), {btnW, btnH})) {
            RunAsync([cmds = std::vector<TweakGroup>{ g }]() {
                std::atomic<float> p = 0.f;
                ApplyTweakGroups(cmds, p, MakeLog());
                g_app.progress.store(1.f);
            });
        }
        if (busy) ImGui::EndDisabled();

        // Tooltip: list commands
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayShort)) {
            ImGui::BeginTooltip();
            ImGui::PushStyleColor(ImGuiCol_Text, C_ACCENT);
            ImGui::Text("%s", g.name.c_str());
            ImGui::PopStyleColor();
            ImGui::Separator();
            for (size_t k = 0; k < std::min(g.cmds.size(), (size_t)6); k++)
                ImGui::TextUnformatted(g.cmds[k].substr(0, 72).c_str());
            if (g.cmds.size() > 6)
                ImGui::TextDisabled("...and %d more", (int)g.cmds.size() - 6);
            ImGui::EndTooltip();
        }

        col++;
        if (col < 3) ImGui::SameLine(0.f, gap);
        else { col = 0; ImGui::Dummy({0.f, 2.f}); }
    }
}

// ─── Log panel ────────────────────────────────────────────────────────────
static void DrawLogPanel(float height) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, {0.02f, 0.025f, 0.05f, 1.f});
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.f);
    if (ImGui::BeginChild("##log", {-1.f, height}, true,
        ImGuiWindowFlags_HorizontalScrollbar))
    {
        std::lock_guard<std::mutex> lk(g_app.logMutex);
        ImGuiListClipper clipper;
        clipper.Begin((int)g_app.logLines.size());
        while (clipper.Step())
            for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
                auto& [text, ok] = g_app.logLines[i];
                bool isHdr = text.find("====") != std::string::npos
                          || text.find(">> ")  != std::string::npos;
                ImVec4 col = isHdr ? C_ACCENT : (ok ? C_GREEN : C_TEXTDIM);
                ImGui::TextColored(col, "%s", text.c_str());
            }
        if (g_app.scrollToBottom) {
            ImGui::SetScrollHereY(1.f);
            g_app.scrollToBottom = false;
        }
        ImGui::EndChild();
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

// ─── Reboot dialog ────────────────────────────────────────────────────────
static void DrawRebootDialog() {
    if (!g_app.showRebootDlg) return;
    ImGui::OpenPopup("Restart Required##dlg");
    ImGui::SetNextWindowSize({360.f, 0.f});
    if (ImGui::BeginPopupModal("Restart Required##dlg", nullptr,
        ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoMove))
    {
        ImGui::Dummy({0.f, 6.f});
        ImGui::TextColored(C_ACCENT, "  All tweaks have been applied!");
        ImGui::Separator();
        ImGui::Dummy({0.f, 4.f});
        ImGui::TextColored(C_TEXTDIM, "  Restart your PC to activate all changes.");
        ImGui::Dummy({0.f, 12.f});

        if (AccentButton("  Restart Now  ", {160.f, 38.f})) {
            system("shutdown /r /t 5 /c \"Eminence Tweak — Restarting\"");
            g_app.showRebootDlg = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine(0.f, 10.f);
        if (ImGui::Button("  Later  ", {100.f, 38.f})) {
            g_app.showRebootDlg = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::Dummy({0.f, 6.f});
        ImGui::EndPopup();
    }
}

// ─── Custom title bar ─────────────────────────────────────────────────────
static bool DrawTitleBar(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();
    float barH  = 52.f;

    ImGui::SetNextWindowPos({0.f, 0.f});
    ImGui::SetNextWindowSize({io.DisplaySize.x, barH});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, {0.016f, 0.024f, 0.047f, 1.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {16.f, 0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.f);
    ImGui::Begin("##titlebar", nullptr,
        ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();

    // Logo
    ImGui::SetCursorPos({16.f, (barH - ImGui::GetTextLineHeight() * 1.6f) * 0.5f});
    ImGui::PushStyleColor(ImGuiCol_Text, C_ACCENT);
    ImGui::SetWindowFontScale(1.3f);
    ImGui::Text("EMINENCE");
    ImGui::PopStyleColor();
    ImGui::SameLine(0.f, 6.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
    ImGui::Text("TWEAK");
    ImGui::PopStyleColor();
    ImGui::SetWindowFontScale(1.f);
    ImGui::SameLine(0.f, 10.f);
    ImGui::SetCursorPosY((barH - ImGui::GetTextLineHeight()) * 0.5f + 2.f);
    ImGui::PushStyleColor(ImGuiCol_Text, C_TEXTDIM);
    ImGui::Text("v3.0");
    ImGui::PopStyleColor();

    // Admin badge
    bool admin = IsAdmin();
    ImGui::SameLine(0.f, 20.f);
    ImGui::SetCursorPosY((barH - ImGui::GetFrameHeight()) * 0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, admin ? C_GREEN : C_RED);
    ImGui::Text(admin ? "  ADMIN" : "  NO ADMIN");
    ImGui::PopStyleColor();

    // Window controls (right side)
    float ctrlW = 90.f;
    ImGui::SetCursorPos({io.DisplaySize.x - ctrlW, 0.f});
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 0.f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, {0.f, 0.f});

    // Minimize
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.f, 0.f, 0.f, 0.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {1.f, 1.f, 1.f, 0.08f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {1.f, 1.f, 1.f, 0.15f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXTDIM);
    if (ImGui::Button(" — ##min", {45.f, barH}))
        ShowWindow(hwnd, SW_MINIMIZE);
    ImGui::PopStyleColor(4);

    // Close
    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.f, 0.f, 0.f, 0.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.8f, 0.1f, 0.1f, 1.f});
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  {0.6f, 0.05f, 0.05f, 1.f});
    ImGui::PushStyleColor(ImGuiCol_Text,          C_TEXTDIM);
    bool closeClicked = ImGui::Button(" X ##cls", {45.f, barH});
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);

    // Bottom border line
    ImVec2 wPos = ImGui::GetWindowPos();
    ImGui::GetWindowDrawList()->AddLine(
        {wPos.x, wPos.y + barH - 1.f},
        {wPos.x + io.DisplaySize.x, wPos.y + barH - 1.f},
        ICOLOR(C_BORDER), 1.f);

    ImGui::End();
    return closeClicked;
}

// ─── Main UI ─────────────────────────────────────────────────────────────
static void DrawMainUI(HWND hwnd) {
    ImGuiIO& io = ImGui::GetIO();

    bool closeClicked = DrawTitleBar(hwnd);
    if (closeClicked) g_wantClose = true;

    float titleH = 52.f;
    ImGui::SetNextWindowPos({0.f, titleH});
    ImGui::SetNextWindowSize({io.DisplaySize.x, io.DisplaySize.y - titleH});
    ImGui::PushStyleColor(ImGuiCol_WindowBg, C_BG);
    ImGui::Begin("##root", nullptr,
        ImGuiWindowFlags_NoTitleBar  | ImGuiWindowFlags_NoResize  |
        ImGuiWindowFlags_NoMove      | ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoSavedSettings);
    ImGui::PopStyleColor();

    // ── Ultra Apply All button ─────────────────────────────────────────
    float ultraW = 360.f;
    ImGui::Dummy({0.f, 8.f});
    ImGui::SetCursorPosX((io.DisplaySize.x - ultraW) * 0.5f);

    bool busy = g_app.running.load();
    if (busy) ImGui::BeginDisabled();
    if (AccentButton("  \xe2\x9a\xa1  APPLY ALL TWEAKS  \xe2\x9a\xa1  ", {ultraW, 46.f})) {
        RunAsync([]() {
            ApplyAllTweaks(g_app.progress, MakeLog());
            g_app.showRebootDlg = true;
        });
    }
    if (busy) ImGui::EndDisabled();

    if (ImGui::IsItemHovered())
        ImGui::SetTooltip("Applies ALL tweaks at once: system, network, GPU\nand optimizes Fortnite, Valorant & Call of Duty.");

    // ── Progress bar ──────────────────────────────────────────────────
    float p = g_app.progress.load();
    ImGui::Dummy({0.f, 8.f});
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, C_ACCENT);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, C_CARD);
    ImGui::ProgressBar(p, {-1.f, 5.f}, "");
    ImGui::PopStyleColor(2);

    // Status text
    ImGui::PushStyleColor(ImGuiCol_Text, busy ? C_ACCENT : C_TEXTDIM);
    ImGui::Text(busy ? "  Running..." : "  Ready  \xe2\x80\x94  hover buttons to see what each tweak does");
    ImGui::PopStyleColor();

    ImGui::Dummy({0.f, 4.f});
    ImGui::Separator();

    // ── Tab bar ───────────────────────────────────────────────────────
    ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
    ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
    ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
    ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
    ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
    if (ImGui::BeginTabBar("##tabs")) {

        // ── TWEAKS ────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Tweaks  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 10.f});
            float logH = 180.f;
            float gridH = ImGui::GetContentRegionAvail().y - logH - 30.f;
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 0.f);
            if (ImGui::BeginChild("##tgrid", {-1.f, gridH}, false))
                DrawTweakGrid(g_systemTweaks);
            ImGui::EndChild();
            ImGui::PopStyleVar();

            ImGui::Separator();
            ImGui::Dummy({0.f, 4.f});
            ImGui::TextColored(C_TEXTDIM, "  Output");
            ImGui::SameLine();
            if (ImGui::SmallButton("Clear##sys"))
                g_app.clearLog();
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        // ── GAMES ─────────────────────────────────────────────────────
        ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
        ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
        ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
        if (ImGui::BeginTabItem("  Games  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 12.f});
            ImGui::TextColored(C_ACCENT, "  Game-specific optimizations");
            ImGui::Dummy({0.f, 10.f});

            float cardW = 260.f, cardH = 140.f, gap = 12.f;
            for (auto& gt : g_gameTweaks) {
                ImGui::PushStyleColor(ImGuiCol_ChildBg, C_CARD);
                ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 10.f);
                if (ImGui::BeginChild(gt.tag.c_str(), {cardW, cardH}, true)) {
                    // Top accent bar
                    ImVec2 p0 = ImGui::GetCursorScreenPos();
                    ImGui::GetWindowDrawList()->AddRectFilled(
                        p0, {p0.x + cardW, p0.y + 3.f},
                        ICOLOR(C_ACCENT), 2.f);
                    ImGui::Dummy({0.f, 6.f});

                    ImGui::TextColored(C_ACCENT, "  %s", gt.name.c_str());
                    ImGui::Separator();
                    ImGui::Dummy({0.f, 4.f});
                    ImGui::TextColored(C_TEXTDIM, "  Low settings  |  CPU priority");
                    ImGui::TextColored(C_TEXTDIM, "  VSync OFF  |  Motion Blur OFF");
                    ImGui::Dummy({0.f, 8.f});

                    std::string lbl = "Optimize##" + gt.tag;
                    if (busy) ImGui::BeginDisabled();
                    if (CyanButton(lbl.c_str(), {-1.f, 32.f})) {
                        RunAsync([name = gt.name]() {
                            for (auto& g : g_gameTweaks)
                                if (g.name == name) {
                                    std::atomic<float> p = 0.f;
                                    ApplyGameTweak(g, p, MakeLog());
                                    g_app.progress.store(1.f);
                                    break;
                                }
                        });
                    }
                    if (busy) ImGui::EndDisabled();
                    ImGui::EndChild();
                }
                ImGui::PopStyleVar();
                ImGui::PopStyleColor();
                ImGui::SameLine(0.f, gap);
            }

            ImGui::Dummy({0.f, 14.f});
            ImGui::Separator();
            if (busy) ImGui::BeginDisabled();
            if (AccentButton("  Optimize ALL Games  ", {260.f, 36.f})) {
                RunAsync([]() {
                    float step = 1.f / g_gameTweaks.size();
                    for (size_t i = 0; i < g_gameTweaks.size(); i++) {
                        std::atomic<float> p = 0.f;
                        ApplyGameTweak(g_gameTweaks[i], p, MakeLog());
                        g_app.progress.store((i + 1) * step);
                    }
                });
            }
            if (busy) ImGui::EndDisabled();
            ImGui::Dummy({0.f, 8.f});
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        // ── NETWORK ───────────────────────────────────────────────────
        ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
        ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
        ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
        if (ImGui::BeginTabItem("  Network  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 8.f});
            if (busy) ImGui::BeginDisabled();
            if (AccentButton("  Apply ALL Network Tweaks  ", {300.f, 36.f})) {
                RunAsync([]() {
                    ApplyTweakGroups(g_networkTweaks, g_app.progress, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            if (busy) ImGui::EndDisabled();
            ImGui::Dummy({0.f, 10.f});
            DrawTweakGrid(g_networkTweaks, 44.f);
            ImGui::Dummy({0.f, 8.f});
            ImGui::Separator();
            ImGui::Dummy({0.f, 4.f});
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        // ── GPU ───────────────────────────────────────────────────────
        ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
        ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
        ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
        if (ImGui::BeginTabItem("  GPU  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 8.f});
            if (busy) ImGui::BeginDisabled();
            if (AccentButton("  Apply ALL GPU Tweaks  ", {280.f, 36.f})) {
                RunAsync([]() {
                    ApplyTweakGroups(g_gpuTweaks, g_app.progress, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            if (busy) ImGui::EndDisabled();
            ImGui::Dummy({0.f, 10.f});
            DrawTweakGrid(g_gpuTweaks, 44.f);
            ImGui::Dummy({0.f, 8.f});
            ImGui::Separator();
            ImGui::Dummy({0.f, 4.f});
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        // ── CLEANUP ───────────────────────────────────────────────────
        ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
        ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
        ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
        if (ImGui::BeginTabItem("  Cleanup  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 16.f});
            ImGui::TextColored(C_TEXTDIM, "  Deletes temporary files to free up space and improve load times.");
            ImGui::Dummy({0.f, 16.f});
            if (busy) ImGui::BeginDisabled();
            if (AccentButton("  Clean Temp Files  ", {240.f, 44.f})) {
                RunAsync([]() {
                    CleanTempFiles(g_app.progress, MakeLog());
                });
            }
            if (busy) ImGui::EndDisabled();
            ImGui::Dummy({0.f, 14.f});
            ImGui::Separator();
            ImGui::Dummy({0.f, 8.f});
            ImGui::TextColored(C_TEXTDIM, "  Folders cleaned:");
            ImGui::TextColored(C_ACCENTD, "   \xe2\x80\xa2  %%TEMP%%");
            ImGui::TextColored(C_ACCENTD, "   \xe2\x80\xa2  C:\\Windows\\Temp");
            ImGui::TextColored(C_ACCENTD, "   \xe2\x80\xa2  C:\\Windows\\Prefetch");
            ImGui::TextColored(C_ACCENTD, "   \xe2\x80\xa2  %%LOCALAPPDATA%%\\Temp");
            ImGui::Dummy({0.f, 10.f});
            ImGui::Separator();
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        // ── LOG ───────────────────────────────────────────────────────
        ImGui::PushStyleColor(ImGuiCol_Tab,            {0.027f, 0.039f, 0.078f, 1.f});
        ImGui::PushStyleColor(ImGuiCol_TabActive,      C_CARD);
        ImGui::PushStyleColor(ImGuiCol_TabHovered,     C_CARD_H);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocused,   C_BG);
        ImGui::PushStyleColor(ImGuiCol_TabUnfocusedActive, C_BG2);
        if (ImGui::BeginTabItem("  Log  ")) {
            ImGui::PopStyleColor(5);
            ImGui::Dummy({0.f, 6.f});
            if (ImGui::SmallButton("  Clear  ")) g_app.clearLog();
            ImGui::SameLine();
            ImGui::TextColored(C_TEXTDIM, "%zu lines", g_app.logLines.size());
            ImGui::Dummy({0.f, 4.f});
            DrawLogPanel(ImGui::GetContentRegionAvail().y - 10.f);
            ImGui::EndTabItem();
        } else ImGui::PopStyleColor(5);

        ImGui::EndTabBar();
    }

    DrawRebootDialog();
    ImGui::End();
}

// ─── D3D11 ────────────────────────────────────────────────────────────────
static bool CreateDeviceD3D(HWND hWnd) {
    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount                        = 2;
    sd.BufferDesc.Format                  = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.Flags                              = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    sd.BufferUsage                        = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow                       = hWnd;
    sd.SampleDesc.Count                   = 1;
    sd.Windowed                           = TRUE;
    sd.SwapEffect                         = DXGI_SWAP_EFFECT_DISCARD;

    D3D_FEATURE_LEVEL featureLevelArray[2] = {
        D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0 };
    D3D_FEATURE_LEVEL featureLevel;
    HRESULT res = D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
        featureLevelArray, 2, D3D11_SDK_VERSION, &sd,
        &g_pSwapChain, &g_pd3dDevice, &featureLevel, &g_pd3dDeviceContext);
    if (res == DXGI_ERROR_UNSUPPORTED)
        res = D3D11CreateDeviceAndSwapChain(
            nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0,
            featureLevelArray, 2, D3D11_SDK_VERSION, &sd,
            &g_pSwapChain, &g_pd3dDevice, &featureLevel, &g_pd3dDeviceContext);
    if (FAILED(res)) return false;
    CreateRenderTarget();
    return true;
}

static void CleanupDeviceD3D() {
    CleanupRenderTarget();
    if (g_pSwapChain)        { g_pSwapChain->Release();       g_pSwapChain = nullptr; }
    if (g_pd3dDeviceContext) { g_pd3dDeviceContext->Release(); g_pd3dDeviceContext = nullptr; }
    if (g_pd3dDevice)        { g_pd3dDevice->Release();        g_pd3dDevice = nullptr; }
}
static void CreateRenderTarget() {
    ID3D11Texture2D* pBack = nullptr;
    g_pSwapChain->GetBuffer(0, IID_PPV_ARGS(&pBack));
    g_pd3dDevice->CreateRenderTargetView(pBack, nullptr, &g_mainRenderTargetView);
    pBack->Release();
}
static void CleanupRenderTarget() {
    if (g_mainRenderTargetView) {
        g_mainRenderTargetView->Release();
        g_mainRenderTargetView = nullptr;
    }
}

// ─── WndProc ──────────────────────────────────────────────────────────────
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (ImGui_ImplWin32_WndProcHandler(hWnd, msg, wParam, lParam)) return TRUE;
    switch (msg) {
    case WM_SIZE:
        if (wParam == SIZE_MINIMIZED) return 0;
        g_ResizeWidth  = LOWORD(lParam);
        g_ResizeHeight = HIWORD(lParam);
        return 0;
    case WM_NCHITTEST: {
        // Allow dragging via the custom title bar area
        LRESULT hit = DefWindowProcW(hWnd, msg, wParam, lParam);
        if (hit == HTCLIENT) {
            POINT pt; GetCursorPos(&pt); ScreenToClient(hWnd, &pt);
            if (pt.y < 52 && pt.x < (int)GetSystemMetrics(SM_CXSCREEN) - 95)
                return HTCAPTION;
        }
        return hit;
    }
    case WM_SYSCOMMAND:
        if ((wParam & 0xFFF0) == SC_KEYMENU) return 0;
        break;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

// ─── WinMain ──────────────────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
    WNDCLASSEXW wc = {
        sizeof(wc), CS_CLASSDC, WndProc, 0L, 0L,
        GetModuleHandleW(nullptr), nullptr, nullptr, nullptr, nullptr,
        L"EminenceTweak3", nullptr
    };
    RegisterClassExW(&wc);

    // Borderless window
    HWND hwnd = CreateWindowExW(
        WS_EX_APPWINDOW,
        wc.lpszClassName, L"Eminence Tweak  —  Gaming Optimizer",
        WS_POPUP | WS_VISIBLE | WS_SYSMENU | WS_MINIMIZEBOX,
        100, 80, 960, 700,
        nullptr, nullptr, wc.hInstance, nullptr);

    // DWM: rounded corners + drop shadow
    {
        DWORD cornerPref = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(hwnd, 33 /*DWMWA_WINDOW_CORNER_PREFERENCE*/,
                              &cornerPref, sizeof(cornerPref));
        MARGINS m = {1, 1, 1, 1};
        DwmExtendFrameIntoClientArea(hwnd, &m);
    }

    if (!CreateDeviceD3D(hwnd)) {
        CleanupDeviceD3D(); UnregisterClassW(wc.lpszClassName, wc.hInstance);
        return 1;
    }
    ShowWindow(hwnd, SW_SHOWDEFAULT);
    UpdateWindow(hwnd);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ApplyTheme();
    ImGui_ImplWin32_Init(hwnd);
    ImGui_ImplDX11_Init(g_pd3dDevice, g_pd3dDeviceContext);

    // Font — prefer Segoe UI
    const char* fonts[] = {
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\calibri.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
    };
    bool fontLoaded = false;
    for (auto fp : fonts) {
        if (GetFileAttributesA(fp) != INVALID_FILE_ATTRIBUTES) {
            io.Fonts->AddFontFromFileTTF(fp, 15.f);
            fontLoaded = true;
            break;
        }
    }
    if (!fontLoaded) io.Fonts->AddFontDefault();

    constexpr float CLEAR_COLOR[4] = { 0.027f, 0.035f, 0.063f, 1.f };

    MSG msg = {};
    while (msg.message != WM_QUIT) {
        if (PeekMessageW(&msg, nullptr, 0U, 0U, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            continue;
        }
        if (g_wantClose) break;

        if (g_ResizeWidth != 0 && g_ResizeHeight != 0) {
            CleanupRenderTarget();
            g_pSwapChain->ResizeBuffers(0, g_ResizeWidth, g_ResizeHeight,
                                        DXGI_FORMAT_UNKNOWN, 0);
            g_ResizeWidth = g_ResizeHeight = 0;
            CreateRenderTarget();
        }

        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();

        if (g_phase == AppPhase::Loading) {
            g_loadTimer += io.DeltaTime;
            DrawLoadingScreen();
        } else {
            DrawMainUI(hwnd);
        }

        ImGui::Render();
        g_pd3dDeviceContext->OMSetRenderTargets(1, &g_mainRenderTargetView, nullptr);
        g_pd3dDeviceContext->ClearRenderTargetView(g_mainRenderTargetView, CLEAR_COLOR);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
        g_pSwapChain->Present(1, 0);
    }

    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();
    CleanupDeviceD3D();
    DestroyWindow(hwnd);
    UnregisterClassW(wc.lpszClassName, wc.hInstance);
    return 0;
}
