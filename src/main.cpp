/*
 * ███████╗███╗   ███╗██╗███╗   ██╗███████╗███╗   ██╗ ██████╗███████╗
 * ██╔════╝████╗ ████║██║████╗  ██║██╔════╝████╗  ██║██╔════╝██╔════╝
 * █████╗  ██╔████╔██║██║██╔██╗ ██║█████╗  ██╔██╗ ██║██║     █████╗
 * ██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██║╚██╗██║██║     ██╔══╝
 * ███████╗██║ ╚═╝ ██║██║██║ ╚████║███████╗██║ ╚████║╚██████╗███████╗
 * ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
 *
 * Eminence Tweak — Gaming PC Optimizer v2.0
 * Dear ImGui + DirectX 11 backend
 * Red & Black theme — Made for gamers
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

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")

#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"

#include "tweaks.h"

// ─── Globals ─────────────────────────────────────────────────────────────
static ID3D11Device*            g_pd3dDevice           = nullptr;
static ID3D11DeviceContext*     g_pd3dDeviceContext    = nullptr;
static IDXGISwapChain*          g_pSwapChain           = nullptr;
static UINT                     g_ResizeWidth          = 0;
static UINT                     g_ResizeHeight         = 0;
static ID3D11RenderTargetView*  g_mainRenderTargetView = nullptr;

// ─── App state ────────────────────────────────────────────────────────────
struct AppState {
    std::atomic<float>  progress{ 0.f };
    std::atomic<bool>   running{ false };
    std::mutex          logMutex;
    std::vector<std::pair<std::string, bool>> logLines; // (text, isOk)
    bool                scrollToBottom = false;
    bool                showRebootDlg  = false;

    void addLog(const std::string& msg, bool ok = true) {
        std::lock_guard<std::mutex> lk(logMutex);
        // timestamp
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

// ─── D3D11 helpers ───────────────────────────────────────────────────────
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

// ─── Theme ────────────────────────────────────────────────────────────────
static void ApplyEminenceTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding    = 8.f;
    s.ChildRounding     = 6.f;
    s.FrameRounding     = 5.f;
    s.GrabRounding      = 4.f;
    s.TabRounding       = 5.f;
    s.ScrollbarRounding = 6.f;
    s.PopupRounding     = 6.f;
    s.WindowBorderSize  = 1.f;
    s.FrameBorderSize   = 0.f;
    s.TabBorderSize     = 0.f;
    s.WindowPadding     = ImVec2(14.f, 12.f);
    s.FramePadding      = ImVec2(10.f, 6.f);
    s.ItemSpacing       = ImVec2(8.f, 7.f);
    s.ItemInnerSpacing  = ImVec2(6.f, 4.f);
    s.IndentSpacing     = 18.f;
    s.ScrollbarSize     = 11.f;

    auto* c = s.Colors;
    // Background
    c[ImGuiCol_WindowBg]          = ImVec4(0.038f, 0.028f, 0.028f, 1.f);
    c[ImGuiCol_ChildBg]           = ImVec4(0.060f, 0.040f, 0.040f, 1.f);
    c[ImGuiCol_PopupBg]           = ImVec4(0.070f, 0.045f, 0.045f, 1.f);
    c[ImGuiCol_MenuBarBg]         = ImVec4(0.050f, 0.030f, 0.030f, 1.f);
    // Frame
    c[ImGuiCol_FrameBg]           = ImVec4(0.085f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_FrameBgHovered]    = ImVec4(0.160f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_FrameBgActive]     = ImVec4(0.200f, 0.060f, 0.060f, 1.f);
    // Title
    c[ImGuiCol_TitleBg]           = ImVec4(0.100f, 0.020f, 0.020f, 1.f);
    c[ImGuiCol_TitleBgActive]     = ImVec4(0.500f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_TitleBgCollapsed]  = ImVec4(0.080f, 0.020f, 0.020f, 1.f);
    // Buttons
    c[ImGuiCol_Button]            = ImVec4(0.480f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_ButtonHovered]     = ImVec4(0.750f, 0.100f, 0.100f, 1.f);
    c[ImGuiCol_ButtonActive]      = ImVec4(0.600f, 0.040f, 0.040f, 1.f);
    // Checkbox / radio
    c[ImGuiCol_CheckMark]         = ImVec4(1.000f, 0.300f, 0.300f, 1.f);
    // Slider
    c[ImGuiCol_SliderGrab]        = ImVec4(0.800f, 0.150f, 0.150f, 1.f);
    c[ImGuiCol_SliderGrabActive]  = ImVec4(1.000f, 0.250f, 0.250f, 1.f);
    // Scrollbar
    c[ImGuiCol_ScrollbarBg]       = ImVec4(0.020f, 0.010f, 0.010f, 1.f);
    c[ImGuiCol_ScrollbarGrab]     = ImVec4(0.400f, 0.040f, 0.040f, 1.f);
    c[ImGuiCol_ScrollbarGrabHovered] = ImVec4(0.700f, 0.100f, 0.100f, 1.f);
    c[ImGuiCol_ScrollbarGrabActive]  = ImVec4(0.900f, 0.150f, 0.150f, 1.f);
    // Separator & border
    c[ImGuiCol_Separator]         = ImVec4(0.400f, 0.060f, 0.060f, 1.f);
    c[ImGuiCol_SeparatorHovered]  = ImVec4(0.700f, 0.100f, 0.100f, 1.f);
    c[ImGuiCol_SeparatorActive]   = ImVec4(0.900f, 0.150f, 0.150f, 1.f);
    c[ImGuiCol_Border]            = ImVec4(0.350f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_BorderShadow]      = ImVec4(0.f, 0.f, 0.f, 0.f);
    // Header (collapsing)
    c[ImGuiCol_Header]            = ImVec4(0.400f, 0.050f, 0.050f, 1.f);
    c[ImGuiCol_HeaderHovered]     = ImVec4(0.600f, 0.080f, 0.080f, 1.f);
    c[ImGuiCol_HeaderActive]      = ImVec4(0.750f, 0.100f, 0.100f, 1.f);
    // Tabs
    c[ImGuiCol_Tab]               = ImVec4(0.200f, 0.030f, 0.030f, 1.f);
    c[ImGuiCol_TabHovered]        = ImVec4(0.700f, 0.100f, 0.100f, 1.f);
    c[ImGuiCol_TabActive]         = ImVec4(0.550f, 0.080f, 0.080f, 1.f);
    c[ImGuiCol_TabUnfocused]      = ImVec4(0.100f, 0.020f, 0.020f, 1.f);
    c[ImGuiCol_TabUnfocusedActive]= ImVec4(0.250f, 0.040f, 0.040f, 1.f);
    // Progress bar
    c[ImGuiCol_PlotHistogram]     = ImVec4(0.860f, 0.120f, 0.120f, 1.f);
    c[ImGuiCol_PlotHistogramHovered] = ImVec4(1.f, 0.200f, 0.200f, 1.f);
    // Text
    c[ImGuiCol_Text]              = ImVec4(0.920f, 0.910f, 0.910f, 1.f);
    c[ImGuiCol_TextDisabled]      = ImVec4(0.500f, 0.380f, 0.380f, 1.f);
    c[ImGuiCol_TextSelectedBg]    = ImVec4(0.600f, 0.080f, 0.080f, 0.6f);
    // Resize grip
    c[ImGuiCol_ResizeGrip]        = ImVec4(0.500f, 0.060f, 0.060f, 0.5f);
    c[ImGuiCol_ResizeGripHovered] = ImVec4(0.800f, 0.120f, 0.120f, 1.f);
    c[ImGuiCol_ResizeGripActive]  = ImVec4(1.000f, 0.180f, 0.180f, 1.f);
    // NavHighlight
    c[ImGuiCol_NavHighlight]      = ImVec4(0.900f, 0.200f, 0.200f, 1.f);
    // Modal dimmer
    c[ImGuiCol_ModalWindowDimBg]  = ImVec4(0.f, 0.f, 0.f, 0.65f);
}

// ─── Colour helpers ───────────────────────────────────────────────────────
static constexpr ImVec4 kRed      = ImVec4(0.90f, 0.12f, 0.12f, 1.f);
static constexpr ImVec4 kRedBr    = ImVec4(1.00f, 0.22f, 0.22f, 1.f);
static constexpr ImVec4 kRedDim   = ImVec4(0.55f, 0.06f, 0.06f, 1.f);
static constexpr ImVec4 kWhite    = ImVec4(1.f, 1.f, 1.f, 1.f);
static constexpr ImVec4 kGray     = ImVec4(0.50f, 0.38f, 0.38f, 1.f);
static constexpr ImVec4 kGreen    = ImVec4(0.30f, 0.85f, 0.30f, 1.f);

// ─── Async runner ────────────────────────────────────────────────────────
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
    return [](const std::string& msg, bool ok) {
        g_app.addLog(msg, ok);
    };
}

// ─── UI: Banner ──────────────────────────────────────────────────────────
static void DrawBanner() {
    float avail = ImGui::GetContentRegionAvail().x;
    ImGui::Dummy(ImVec2(0.f, 6.f));

    // Logo text
    ImGui::SetCursorPosX((avail - ImGui::CalcTextSize("EMINENCE  TWEAK").x) * 0.5f);
    ImGui::TextColored(kRed,   "EMINENCE");
    ImGui::SameLine();
    ImGui::TextColored(kWhite, "TWEAK");
    ImGui::SameLine();
    ImGui::TextColored(kGray,  "v2.0");

    // Subtitle
    const char* sub = "Gaming PC Optimizer  |  Fortnite  *  Valorant  *  Call of Duty";
    ImGui::SetCursorPosX((avail - ImGui::CalcTextSize(sub).x) * 0.5f);
    ImGui::TextColored(kGray, "%s", sub);

    // Status bar
    ImGui::Dummy(ImVec2(0.f, 4.f));
    bool admin = IsAdmin();
    ImGui::TextColored(kGray, "  Admin:");
    ImGui::SameLine();
    ImGui::TextColored(admin ? kGreen : kRed, admin ? "OUI" : "NON");
    ImGui::SameLine(0.f, 20.f);
    ImGui::TextColored(kGray, "Discord:");
    ImGui::SameLine();
    ImGui::TextColored(kRedBr, "discord.gg/eminence");
    ImGui::SameLine(0.f, 30.f);
    if (g_app.running.load()) {
        ImGui::TextColored(kRed, "[  En cours...  ]");
    } else {
        ImGui::TextColored(kGreen, "[  Pret  ]");
    }

    ImGui::Dummy(ImVec2(0.f, 4.f));
    ImGui::Separator();
    ImGui::Dummy(ImVec2(0.f, 6.f));
}

// ─── UI: Progress bar ─────────────────────────────────────────────────────
static void DrawProgress() {
    float p = g_app.progress.load();
    char buf[32]; snprintf(buf, sizeof(buf), "%.0f%%", p * 100.f);
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, kRed);
    ImGui::ProgressBar(p, ImVec2(-1.f, 10.f), p > 0.f ? buf : "");
    ImGui::PopStyleColor();
    ImGui::Dummy(ImVec2(0.f, 6.f));
}

// ─── UI: Log panel ───────────────────────────────────────────────────────
static void DrawLog() {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.03f, 0.02f, 0.02f, 1.f));
    if (ImGui::BeginChild("##log", ImVec2(-1.f, -1.f), true,
                          ImGuiWindowFlags_HorizontalScrollbar))
    {
        std::lock_guard<std::mutex> lk(g_app.logMutex);
        ImGuiListClipper clipper;
        clipper.Begin((int)g_app.logLines.size());
        while (clipper.Step())
        {
            for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; i++)
            {
                auto& [text, ok] = g_app.logLines[i];
                bool isOk = text.find("[OK]") != std::string::npos;
                bool isHdr = text.find("====") != std::string::npos
                          || text.find(">>")   != std::string::npos;
                ImVec4 col = isHdr ? kRedBr : (isOk ? kGreen : kGray);
                ImGui::TextColored(col, "%s", text.c_str());
            }
        }
        if (g_app.scrollToBottom) {
            ImGui::SetScrollHereY(1.f);
            g_app.scrollToBottom = false;
        }
        ImGui::EndChild();
    }
    ImGui::PopStyleColor();
}

// ─── UI: Big red button ───────────────────────────────────────────────────
static bool BigRedButton(const char* label, ImVec2 sz = ImVec2(0.f, 0.f)) {
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.06f, 0.06f, 1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.90f, 0.14f, 0.14f, 1.f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.70f, 0.08f, 0.08f, 1.f));
    bool clicked = ImGui::Button(label, sz);
    ImGui::PopStyleColor(3);
    return clicked;
}

// ─── UI: Game card ────────────────────────────────────────────────────────
static void DrawGameCard(const GameTweak& gt) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.07f, 0.04f, 0.04f, 1.f));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.f);
    if (ImGui::BeginChild(gt.tag.c_str(), ImVec2(280.f, 150.f), true)) {
        ImGui::Dummy(ImVec2(0.f, 4.f));
        // Title bar effect
        ImVec2 pos = ImGui::GetCursorScreenPos();
        ImVec2 barEnd = ImVec2(pos.x + ImGui::GetContentRegionAvail().x, pos.y + 3.f);
        ImGui::GetWindowDrawList()->AddRectFilled(pos, barEnd,
            IM_COL32(200, 30, 30, 255), 2.f);
        ImGui::Dummy(ImVec2(0.f, 6.f));

        ImGui::TextColored(kRedBr, "  %s", gt.name.c_str());
        ImGui::Separator();
        ImGui::Dummy(ImVec2(0.f, 4.f));
        ImGui::TextColored(kGray, "  Config LOW + CPU haute priorite");
        ImGui::TextColored(kGray, "  VSync OFF | Motion Blur OFF");
        ImGui::Dummy(ImVec2(0.f, 8.f));

        std::string btnLabel = "Optimiser " + gt.tag;
        if (BigRedButton(btnLabel.c_str(), ImVec2(-1.f, 34.f))) {
            RunAsync([key = gt.name]() {
                for (auto& g : g_gameTweaks)
                    if (g.name == key) {
                        std::atomic<float> p = 0.f;
                        ApplyGameTweak(g, p, MakeLog());
                        g_app.progress.store(1.f);
                        break;
                    }
            });
        }
        ImGui::EndChild();
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

// ─── UI: Tweak group collapsible ─────────────────────────────────────────
static void DrawTweakGroupList(const std::vector<TweakGroup>& groups) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.03f, 0.02f, 0.02f, 1.f));
    if (ImGui::BeginChild("##tlist", ImVec2(-1.f, -1.f), false))
    {
        for (auto& g : groups)
        {
            ImGui::PushStyleColor(ImGuiCol_Header,        ImVec4(0.32f, 0.04f, 0.04f, 1.f));
            ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.55f, 0.07f, 0.07f, 1.f));
            ImGui::PushStyleColor(ImGuiCol_HeaderActive,  ImVec4(0.70f, 0.10f, 0.10f, 1.f));
            bool open = ImGui::CollapsingHeader(g.name.c_str());
            ImGui::PopStyleColor(3);

            if (open) {
                for (auto& cmd : g.cmds)
                    ImGui::TextColored(kGray, "   > %s", cmd.c_str());

                ImGui::Dummy(ImVec2(0.f, 4.f));
                std::string btnId = "Appliquer##" + g.name;
                if (BigRedButton(btnId.c_str(), ImVec2(300.f, 30.f)))
                {
                    RunAsync([cmds = std::vector<TweakGroup>{ g }]() {
                        std::atomic<float> p = 0.f;
                        ApplyTweakGroups(cmds, p, MakeLog());
                        g_app.progress.store(1.f);
                    });
                }
                ImGui::Dummy(ImVec2(0.f, 6.f));
            }
        }
        ImGui::EndChild();
    }
    ImGui::PopStyleColor();
}

// ─── Reboot dialog ───────────────────────────────────────────────────────
static void DrawRebootDialog() {
    if (!g_app.showRebootDlg) return;
    ImGui::OpenPopup("Redemarrage##dlg");
    if (ImGui::BeginPopupModal("Redemarrage##dlg", nullptr,
        ImGuiWindowFlags_AlwaysAutoResize))
    {
        ImGui::TextColored(kRedBr, " Tous les tweaks ont ete appliques !");
        ImGui::Separator();
        ImGui::TextColored(kGray,  " Redemarrez votre PC pour activer");
        ImGui::TextColored(kGray,  " tous les changements.");
        ImGui::Dummy(ImVec2(0.f, 8.f));
        if (BigRedButton("  Redemarrer maintenant  ", ImVec2(220.f, 36.f))) {
            system("shutdown /r /t 5 /c \"Eminence Tweak - Redemarrage\"");
            g_app.showRebootDlg = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("  Plus tard  ", ImVec2(120.f, 36.f))) {
            g_app.showRebootDlg = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
}

// ─── Main UI ─────────────────────────────────────────────────────────────
static void DrawMainUI() {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0.f, 0.f));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::Begin("##root", nullptr,
        ImGuiWindowFlags_NoTitleBar      |
        ImGuiWindowFlags_NoResize        |
        ImGuiWindowFlags_NoMove          |
        ImGuiWindowFlags_NoScrollbar     |
        ImGuiWindowFlags_NoScrollWithMouse |
        ImGuiWindowFlags_NoBringToFrontOnFocus);

    DrawBanner();
    DrawProgress();

    // ── Ultra button ──────────────────────────────────────────────────────
    float btnW = 420.f;
    ImGui::SetCursorPosX((ImGui::GetContentRegionAvail().x - btnW) * 0.5f);
    if (BigRedButton("   \xe2\x98\x85   ULTRA MODE  \xe2\x80\x94  TOUT APPLIQUER   \xe2\x98\x85   ",
                     ImVec2(btnW, 48.f)))
    {
        RunAsync([]() {
            ApplyAllTweaks(g_app.progress, MakeLog());
            g_app.showRebootDlg = true;
        });
    }
    if (ImGui::IsItemHovered())
        ImGui::SetTooltip("Applique TOUS les tweaks : systeme, reseau, GPU\net optimise Fortnite, Valorant & COD en un clic.");

    ImGui::Dummy(ImVec2(0.f, 8.f));
    ImGui::Separator();
    ImGui::Dummy(ImVec2(0.f, 4.f));

    // ── Tabs ─────────────────────────────────────────────────────────────
    if (ImGui::BeginTabBar("##tabs"))
    {
        // ── Jeux ──────────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Jeux  "))
        {
            ImGui::Dummy(ImVec2(0.f, 10.f));
            ImGui::TextColored(kRedBr, "  Optimisations par jeu");
            ImGui::Dummy(ImVec2(0.f, 8.f));

            // Game cards row
            ImGui::Indent(8.f);
            for (auto& gt : g_gameTweaks)
            {
                DrawGameCard(gt);
                ImGui::SameLine(0.f, 12.f);
            }
            ImGui::Unindent(8.f);

            ImGui::Dummy(ImVec2(0.f, 14.f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.f, 8.f));

            if (BigRedButton("  Optimiser TOUS les jeux  ", ImVec2(300.f, 38.f)))
            {
                RunAsync([]() {
                    float step = 1.f / (float)g_gameTweaks.size();
                    for (size_t i = 0; i < g_gameTweaks.size(); i++) {
                        std::atomic<float> p = 0.f;
                        ApplyGameTweak(g_gameTweaks[i], p, MakeLog());
                        g_app.progress.store((float)(i + 1) * step);
                    }
                });
            }
            ImGui::Dummy(ImVec2(0.f, 8.f));

            // Log embedded
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.f, 4.f));
            ImGui::TextColored(kGray, "  Sortie :");
            float logH = ImGui::GetContentRegionAvail().y - 10.f;
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.03f, 0.02f, 0.02f, 1.f));
            if (ImGui::BeginChild("##jlog", ImVec2(-1.f, logH), true))
            {
                std::lock_guard<std::mutex> lk(g_app.logMutex);
                for (auto& [text, ok] : g_app.logLines)
                    ImGui::TextColored(ok ? kGreen : kGray, "%s", text.c_str());
                if (g_app.scrollToBottom) ImGui::SetScrollHereY(1.f);
                ImGui::EndChild();
            }
            ImGui::PopStyleColor();
            ImGui::EndTabItem();
        }

        // ── Système ──────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Systeme  "))
        {
            ImGui::Dummy(ImVec2(0.f, 6.f));
            if (BigRedButton("  Appliquer TOUS les tweaks systeme  ", ImVec2(360.f, 36.f)))
            {
                RunAsync([]() {
                    ApplyTweakGroups(g_systemTweaks, g_app.progress, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            ImGui::Dummy(ImVec2(0.f, 8.f));
            DrawTweakGroupList(g_systemTweaks);
            ImGui::EndTabItem();
        }

        // ── Réseau ────────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Reseau  "))
        {
            ImGui::Dummy(ImVec2(0.f, 6.f));
            if (BigRedButton("  Appliquer TOUS les tweaks reseau  ", ImVec2(360.f, 36.f)))
            {
                RunAsync([]() {
                    ApplyTweakGroups(g_networkTweaks, g_app.progress, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            ImGui::Dummy(ImVec2(0.f, 8.f));
            DrawTweakGroupList(g_networkTweaks);
            ImGui::EndTabItem();
        }

        // ── GPU ──────────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  GPU / DirectX  "))
        {
            ImGui::Dummy(ImVec2(0.f, 6.f));
            if (BigRedButton("  Appliquer TOUS les tweaks GPU  ", ImVec2(360.f, 36.f)))
            {
                RunAsync([]() {
                    ApplyTweakGroups(g_gpuTweaks, g_app.progress, MakeLog());
                    g_app.progress.store(1.f);
                });
            }
            ImGui::Dummy(ImVec2(0.f, 8.f));
            DrawTweakGroupList(g_gpuTweaks);
            ImGui::EndTabItem();
        }

        // ── Nettoyage ────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Nettoyage  "))
        {
            ImGui::Dummy(ImVec2(0.f, 12.f));
            ImGui::TextColored(kGray, "  Supprime les fichiers temporaires pour ameliorer");
            ImGui::TextColored(kGray, "  les temps de chargement et liberer de l'espace.");
            ImGui::Dummy(ImVec2(0.f, 14.f));
            if (BigRedButton("  Nettoyer le PC  ", ImVec2(260.f, 42.f)))
            {
                RunAsync([]() {
                    CleanTempFiles(g_app.progress, MakeLog());
                });
            }
            ImGui::Dummy(ImVec2(0.f, 10.f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.f, 6.f));
            ImGui::TextColored(kGray, "  Dossiers nettoyes :");
            ImGui::TextColored(kRedDim, "   *  %%TEMP%%");
            ImGui::TextColored(kRedDim, "   *  C:\\Windows\\Temp");
            ImGui::TextColored(kRedDim, "   *  C:\\Windows\\Prefetch");
            ImGui::EndTabItem();
        }

        // ── Log ───────────────────────────────────────────────────────────
        if (ImGui::BeginTabItem("  Log  "))
        {
            ImGui::Dummy(ImVec2(0.f, 4.f));
            if (ImGui::Button("  Effacer  "))
                g_app.clearLog();
            ImGui::SameLine();
            ImGui::TextColored(kGray, "%zu lignes", g_app.logLines.size());
            ImGui::Dummy(ImVec2(0.f, 4.f));

            float lh = ImGui::GetContentRegionAvail().y - 10.f;
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.02f, 0.01f, 0.01f, 1.f));
            if (ImGui::BeginChild("##logfull", ImVec2(-1.f, lh), true,
                                  ImGuiWindowFlags_HorizontalScrollbar))
            {
                std::lock_guard<std::mutex> lk(g_app.logMutex);
                ImGuiListClipper clipper;
                clipper.Begin((int)g_app.logLines.size());
                while (clipper.Step())
                    for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
                        auto& [txt, ok] = g_app.logLines[i];
                        bool hdr = txt.find("====") != std::string::npos;
                        ImGui::TextColored(hdr ? kRedBr : (ok ? kGreen : kGray),
                                           "%s", txt.c_str());
                    }
                if (g_app.scrollToBottom) {
                    ImGui::SetScrollHereY(1.f);
                    g_app.scrollToBottom = false;
                }
                ImGui::EndChild();
            }
            ImGui::PopStyleColor();
            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }

    DrawRebootDialog();
    ImGui::End();
}

// ─── D3D11 setup ─────────────────────────────────────────────────────────
static bool CreateDeviceD3D(HWND hWnd) {
    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount                        = 2;
    sd.BufferDesc.Width                   = 0;
    sd.BufferDesc.Height                  = 0;
    sd.BufferDesc.Format                  = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferDesc.RefreshRate.Numerator   = 60;
    sd.BufferDesc.RefreshRate.Denominator = 1;
    sd.Flags                              = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    sd.BufferUsage                        = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow                       = hWnd;
    sd.SampleDesc.Count                   = 1;
    sd.Windowed                           = TRUE;
    sd.SwapEffect                         = DXGI_SWAP_EFFECT_DISCARD;

    UINT createFlags = 0;
    D3D_FEATURE_LEVEL featureLevelArray[2] = {
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_0,
    };
    D3D_FEATURE_LEVEL featureLevel;
    HRESULT res = D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
        createFlags, featureLevelArray, 2,
        D3D11_SDK_VERSION, &sd,
        &g_pSwapChain, &g_pd3dDevice,
        &featureLevel, &g_pd3dDeviceContext);

    if (res == DXGI_ERROR_UNSUPPORTED)
        res = D3D11CreateDeviceAndSwapChain(
            nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
            createFlags, featureLevelArray, 2,
            D3D11_SDK_VERSION, &sd,
            &g_pSwapChain, &g_pd3dDevice,
            &featureLevel, &g_pd3dDeviceContext);

    if (FAILED(res)) return false;
    CreateRenderTarget();
    return true;
}

static void CleanupDeviceD3D() {
    CleanupRenderTarget();
    if (g_pSwapChain)        { g_pSwapChain->Release();        g_pSwapChain = nullptr; }
    if (g_pd3dDeviceContext) { g_pd3dDeviceContext->Release();  g_pd3dDeviceContext = nullptr; }
    if (g_pd3dDevice)        { g_pd3dDevice->Release();         g_pd3dDevice = nullptr; }
}

static void CreateRenderTarget() {
    ID3D11Texture2D* pBackBuffer = nullptr;
    g_pSwapChain->GetBuffer(0, IID_PPV_ARGS(&pBackBuffer));
    g_pd3dDevice->CreateRenderTargetView(pBackBuffer, nullptr, &g_mainRenderTargetView);
    pBackBuffer->Release();
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
    case WM_SYSCOMMAND:
        if ((wParam & 0xFFF0) == SC_KEYMENU) return 0;
        break;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

// ─── WinMain ─────────────────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
    // Register window class
    WNDCLASSEXW wc = {
        sizeof(wc), CS_CLASSDC, WndProc, 0L, 0L,
        GetModuleHandleW(nullptr), nullptr, nullptr, nullptr, nullptr,
        L"EminenceTweak", nullptr
    };
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(
        0, wc.lpszClassName, L"Eminence Tweak  —  Gaming Optimizer",
        WS_OVERLAPPEDWINDOW,
        100, 100, 980, 700,
        nullptr, nullptr, wc.hInstance, nullptr);

    if (!CreateDeviceD3D(hwnd)) {
        CleanupDeviceD3D();
        UnregisterClassW(wc.lpszClassName, wc.hInstance);
        return 1;
    }

    ShowWindow(hwnd, SW_SHOWDEFAULT);
    UpdateWindow(hwnd);

    // ImGui init
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;  // no imgui.ini
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ApplyEminenceTheme();

    ImGui_ImplWin32_Init(hwnd);
    ImGui_ImplDX11_Init(g_pd3dDevice, g_pd3dDeviceContext);

    // Load font
    const char* fontPaths[] = {
        "C:\\Windows\\Fonts\\seguibl.ttf",
        "C:\\Windows\\Fonts\\calibrib.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
    };
    for (auto fp : fontPaths) {
        if (GetFileAttributesA(fp) != INVALID_FILE_ATTRIBUTES) {
            io.Fonts->AddFontFromFileTTF(fp, 16.f);
            break;
        }
    }
    if (io.Fonts->Fonts.empty())
        io.Fonts->AddFontDefault();

    // Clear colour — deep black
    constexpr float CLEAR_COLOR[4] = { 0.03f, 0.02f, 0.02f, 1.f };

    // ── Main loop ─────────────────────────────────────────────────────────
    MSG msg = {};
    while (msg.message != WM_QUIT) {
        if (PeekMessageW(&msg, nullptr, 0U, 0U, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            continue;
        }
        // Handle resize
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

        DrawMainUI();

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
