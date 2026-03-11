#include "tweaks.h"
#include <atomic>
#include <shlobj.h>
#include <shlwapi.h>
#include <filesystem>
#include <fstream>
#include <sstream>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")

namespace fs = std::filesystem;

// ─── Catalogue: Système ───────────────────────────────────────────────────
std::vector<TweakGroup> g_systemTweaks = {
    {
        "Desactiver services inutiles",
        {
            "sc config \"DiagTrack\" start= disabled",
            "sc stop \"DiagTrack\"",
            "sc config \"dmwappushservice\" start= disabled",
            "sc config \"SysMain\" start= disabled",
            "sc stop \"SysMain\"",
            "sc config \"WSearch\" start= disabled",
            "sc stop \"WSearch\"",
            "sc config \"WMPNetworkSvc\" start= disabled",
            "sc config \"MapsBroker\" start= disabled",
            "sc config \"PcaSvc\" start= disabled",
            "sc config \"WerSvc\" start= disabled",
        }
    },
    {
        "Plan d'alimentation Haute performance",
        {
            "powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
            "powercfg /change monitor-timeout-ac 0",
            "powercfg /change disk-timeout-ac 0",
            "powercfg /change standby-timeout-ac 0",
            "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100",
            "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100",
            "powercfg /s SCHEME_CURRENT",
        }
    },
    {
        "Desactiver Xbox Game Bar & DVR",
        {
            "reg add \"HKCU\\Software\\Microsoft\\GameBar\" /v \"AllowAutoGameMode\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\Software\\Microsoft\\GameBar\" /v \"ShowStartupPanel\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_Enabled\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR\" /v \"AllowGameDVR\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Priorite CPU haute pour les jeux",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"GPU Priority\" /t REG_DWORD /d 8 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Priority\" /t REG_DWORD /d 6 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Scheduling Category\" /t REG_SZ /d \"High\" /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"SystemResponsiveness\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"NetworkThrottlingIndex\" /t REG_DWORD /d 4294967295 /f",
        }
    },
    {
        "Optimiser memoire virtuelle",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"LargeSystemCache\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"DisablePagingExecutive\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"ClearPageFileAtShutdown\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Desactiver telemetrie Windows",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection\" /v \"AllowTelemetry\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy\" /v \"TailoredExperiencesWithDiagnosticDataEnabled\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Desactiver Windows Update automatique",
        {
            "sc config \"wuauserv\" start= disabled",
            "sc config \"UsoSvc\" start= disabled",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU\" /v \"NoAutoUpdate\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Desactiver Nagle Algorithm (TCP latence)",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\" /v \"TcpAckFrequency\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\" /v \"TCPNoDelay\" /t REG_DWORD /d 1 /f",
        }
    },
};

// ─── Catalogue: Réseau ────────────────────────────────────────────────────
std::vector<TweakGroup> g_networkTweaks = {
    {
        "Optimiser TCP/IP Stack",
        {
            "netsh int tcp set global autotuninglevel=normal",
            "netsh int tcp set global chimney=disabled",
            "netsh int tcp set global ecncapability=disabled",
            "netsh int tcp set global timestamps=disabled",
            "netsh int tcp set global rss=enabled",
            "netsh int tcp set global fastopen=enabled",
            "netsh int tcp set supplemental Internet congestionprovider=ctcp",
        }
    },
    {
        "Flush DNS + reset Winsock",
        {
            "ipconfig /flushdns",
            "ipconfig /registerdns",
            "netsh winsock reset",
            "netsh int ip reset",
        }
    },
    {
        "DNS Cloudflare 1.1.1.1",
        {
            "netsh interface ip set dns name=\"Ethernet\" static 1.1.1.1",
            "netsh interface ip add dns name=\"Ethernet\" addr=1.0.0.1 index=2",
            "netsh interface ip set dns name=\"Wi-Fi\" static 1.1.1.1",
            "netsh interface ip add dns name=\"Wi-Fi\" addr=1.0.0.1 index=2",
        }
    },
    {
        "Desactiver throttling reseau",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"NetworkThrottlingIndex\" /t REG_DWORD /d 0xffffffff /f",
            "netsh int tcp set global initialRto=2000",
            "netsh int tcp set global minRto=300",
        }
    },
    {
        "QoS - Retirer limite bande passante",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched\" /v \"NonBestEffortLimit\" /t REG_DWORD /d 0 /f",
        }
    },
};

// ─── Catalogue: GPU ───────────────────────────────────────────────────────
std::vector<TweakGroup> g_gpuTweaks = {
    {
        "Hardware-Accelerated GPU Scheduling (HAGS)",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\" /v \"HwSchMode\" /t REG_DWORD /d 2 /f",
        }
    },
    {
        "Desactiver Xbox overlay & captures",
        {
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_FSEBehaviorMode\" /t REG_DWORD /d 2 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_HonorUserFSEBehaviorMode\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_DXGIHonorFSEWindowsCompatible\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_Enabled\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Optimiser DirectX 12 + shader cache",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\DirectX\" /v \"D3D12_ALLOW_TEARING\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\SOFTWARE\\Microsoft\\Direct3D\" /v \"ForceLatentSwapChain\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "NVIDIA - optimisations registre",
        {
            "reg add \"HKCU\\SOFTWARE\\NVIDIA Corporation\\Global\\NVTweak\" /v \"Anisotropic\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\NVIDIA Corporation\\Global\\Startup\" /v \"SendTelemetryData\" /t REG_DWORD /d 0 /f",
        }
    },
};

// ─── Catalogue: Jeux ─────────────────────────────────────────────────────
std::vector<GameTweak> g_gameTweaks = {
    {
        "Fortnite", "FN",
        "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FortniteClient-Win64-Shipping.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        {
            {
                "%LOCALAPPDATA%\\FortniteGame\\Saved\\Config\\WindowsClient\\GameUserSettings.ini",
                "[/Script/FortniteGame.FortGameUserSettings]\r\n"
                "bShowFPSCounter=True\r\nFrameRateLimit=0.000000\r\nResolutionQuality=100\r\n"
                "ViewDistanceQuality=0\r\nAntiAliasingQuality=0\r\nShadowQuality=0\r\n"
                "GlobalIlluminationQuality=0\r\nReflectionQuality=0\r\nPostProcessQuality=0\r\n"
                "TextureQuality=0\r\nEffectsQuality=0\r\nFoliageQuality=0\r\nShadingQuality=0\r\n"
                "bUseDynamicResolution=False\r\nbUseVSync=False\r\nbMotionBlur=False\r\n"
                "bShowGrass=False\r\n"
            },
            {
                "%LOCALAPPDATA%\\FortniteGame\\Saved\\Config\\WindowsClient\\Engine.ini",
                "[SystemSettings]\r\n"
                "r.OneFrameThreadLag=0\r\nr.VSync=0\r\nr.MotionBlurQuality=0\r\n"
                "r.AmbientOcclusionLevels=0\r\nr.LensFlareQuality=0\r\n"
                "r.SceneColorFringeQuality=0\r\nr.EyeAdaptationQuality=0\r\n"
                "r.BloomQuality=0\r\nr.FastBlurThreshold=0\r\nr.Upscale.Quality=0\r\n"
                "r.ShadowQuality=0\r\nr.Shadow.CSM.MaxCascades=0\r\n"
                "r.DynamicGlobalIlluminationMethod=0\r\nfoliage.MinimumScreenSize=1000\r\n"
                "r.TranslucencyLightingVolumeDim=1\r\nr.RefractionQuality=0\r\n"
                "r.SSR.Quality=0\r\nr.MaxAnisotropy=0\r\nr.DepthOfFieldQuality=0\r\n"
                "r.RenderTargetPoolMin=300\r\nr.LightMaxDrawDistanceScale=0\r\n"
            },
        },
        {}
    },
    {
        "Valorant", "VAL",
        "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\VALORANT-Win64-Shipping.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        {
            {
                "%LOCALAPPDATA%\\VALORANT\\Saved\\Config\\Windows\\GameUserSettings.ini",
                "[/Script/ShooterGame.ShooterGameUserSettings]\r\n"
                "bUseVSync=False\r\nFrameRateLimit=0.000000\r\nResolutionQuality=100\r\n"
                "ViewDistanceQuality=0\r\nAntiAliasingQuality=0\r\nShadowQuality=0\r\n"
                "PostProcessQuality=0\r\nTextureQuality=0\r\nEffectsQuality=0\r\n"
                "FoliageQuality=0\r\nShadingQuality=0\r\n"
            },
        },
        {}
    },
    {
        "Call of Duty", "COD",
        "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\cod.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        {},
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\BlackOpsColdWar.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\ModernWarfare.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\Warzone.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        }
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────
std::string ExpandEnvPath(const std::string& path) {
    char buf[MAX_PATH * 2] = {};
    ExpandEnvironmentStringsA(path.c_str(), buf, sizeof(buf));
    return std::string(buf);
}

std::pair<int, std::string> RunShellCmd(const std::string& cmd) {
    std::string fullCmd = "cmd.exe /C \"" + cmd + "\" 2>&1";
    SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, TRUE };
    HANDLE hRead, hWrite;
    if (!CreatePipe(&hRead, &hWrite, &sa, 0))
        return { -1, "pipe failed" };

    STARTUPINFOA si = {};
    si.cb          = sizeof(si);
    si.dwFlags     = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.hStdOutput  = hWrite;
    si.hStdError   = hWrite;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {};

    if (!CreateProcessA(nullptr, const_cast<char*>(fullCmd.c_str()),
                        nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi))
    {
        CloseHandle(hRead); CloseHandle(hWrite);
        return { -1, "CreateProcess failed" };
    }
    CloseHandle(hWrite);

    std::string output;
    char buf[512];
    DWORD read;
    while (ReadFile(hRead, buf, sizeof(buf) - 1, &read, nullptr) && read)
    {
        buf[read] = '\0';
        output += buf;
    }
    CloseHandle(hRead);
    WaitForSingleObject(pi.hProcess, 10000);
    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return { (int)exitCode, output };
}

bool WriteConfigFile(const std::string& envPath, const std::string& content) {
    std::string realPath = ExpandEnvPath(envPath);
    try {
        fs::path p(realPath);
        fs::create_directories(p.parent_path());
        std::ofstream f(p, std::ios::binary);
        if (!f) return false;
        f.write(content.data(), content.size());
        return f.good();
    } catch (...) {
        return false;
    }
}

// ─── High-level apply ─────────────────────────────────────────────────────
void ApplyTweakGroups(const std::vector<TweakGroup>& groups,
                      std::atomic<float>& progress,
                      LogCallback log)
{
    size_t total = 0;
    for (auto& g : groups) total += g.cmds.size();
    if (total == 0) return;

    size_t done = 0;
    for (auto& g : groups)
    {
        log(">> " + g.name, true);
        for (auto& cmd : g.cmds)
        {
            auto [code, out] = RunShellCmd(cmd);
            bool ok = (code == 0);
            log(std::string(ok ? "  [OK] " : "  [??] ") + cmd.substr(0, 80), ok);
            ++done;
            progress.store((float)done / (float)total);
        }
    }
}

void ApplyGameTweak(const GameTweak& game,
                    std::atomic<float>& progress,
                    LogCallback log)
{
    log(">> " + game.name, true);
    size_t steps  = game.files.size() + game.extraCmds.size() + 2;
    size_t done   = 0;

    for (auto& f : game.files)
    {
        bool ok = WriteConfigFile(f.envPath, f.content);
        std::string name = fs::path(ExpandEnvPath(f.envPath)).filename().string();
        log(std::string(ok ? "  [OK] Config: " : "  [!!] Config skipped: ") + name, ok);
        ++done;
        progress.store((float)done / (float)steps);
    }

    if (!game.priorityCmd.empty())
    {
        auto [code, _] = RunShellCmd(game.priorityCmd);
        log(std::string(code == 0 ? "  [OK] " : "  [!!] ") + "CPU Priority haute", code == 0);
        ++done;
        progress.store((float)done / (float)steps);
    }

    for (auto& cmd : game.extraCmds)
    {
        auto [code, _] = RunShellCmd(cmd);
        log(std::string(code == 0 ? "  [OK] " : "  [!!] ") + cmd.substr(0, 75), code == 0);
        ++done;
        progress.store((float)done / (float)steps);
    }
    progress.store(1.0f);
}

void ApplyAllTweaks(std::atomic<float>& progress, LogCallback log)
{
    log("====  ULTRA MODE  ====", true);

    // Weights: sys(40%) + net(20%) + gpu(10%) + games(20%) + clean(10%)
    auto sub = [&](float from, float to, std::atomic<float>& subProg) {
        return [&, from, to]() {
            progress.store(from + subProg.load() * (to - from));
        };
    };

    std::atomic<float> p1 = 0.f;
    auto groups1 = g_systemTweaks;
    ApplyTweakGroups(groups1, p1, log);
    progress.store(0.40f);

    std::atomic<float> p2 = 0.f;
    ApplyTweakGroups(g_networkTweaks, p2, log);
    progress.store(0.60f);

    std::atomic<float> p3 = 0.f;
    ApplyTweakGroups(g_gpuTweaks, p3, log);
    progress.store(0.70f);

    for (auto& gt : g_gameTweaks)
    {
        std::atomic<float> pg = 0.f;
        ApplyGameTweak(gt, pg, log);
    }
    progress.store(0.90f);

    CleanTempFiles(progress, log);
    progress.store(1.0f);
    log("====  DONE — Redemarrez votre PC  ====", true);
}

void CleanTempFiles(std::atomic<float>& progress, LogCallback log)
{
    log(">> Nettoyage fichiers temporaires", true);
    std::vector<std::string> cmds = {
        "del /f /s /q \"%TEMP%\\*\"",
        "del /f /s /q \"C:\\Windows\\Temp\\*\"",
        "del /f /s /q \"C:\\Windows\\Prefetch\\*\"",
    };
    for (size_t i = 0; i < cmds.size(); i++)
    {
        RunShellCmd(cmds[i]);
        log("  [OK] " + cmds[i].substr(0, 70), true);
        progress.store((float)(i + 1) / (float)cmds.size());
    }
}
