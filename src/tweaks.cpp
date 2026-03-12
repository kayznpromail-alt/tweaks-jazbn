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

// ─── System Tweaks ────────────────────────────────────────────────────────
std::vector<TweakGroup> g_systemTweaks = {
    {
        "Disable Unnecessary Services",
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
            "sc config \"RetailDemo\" start= disabled",
            "sc config \"Fax\" start= disabled",
            "sc config \"PrintNotify\" start= disabled",
            "sc config \"RemoteRegistry\" start= disabled",
        }
    },
    {
        "High Performance Power Plan",
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
        "Import Power Plan",
        {
            "powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61",
            "powercfg /setactive e9a42b02-d5df-448d-aa00-03f14749eb61",
        }
    },
    {
        "Remove Default Power Plans",
        {
            "powercfg /delete 381b4222-f694-41f0-9685-ff5bb260df2e",
            "powercfg /delete a1841308-3541-4fab-bc81-f71556f20b4a",
        }
    },
    {
        "Disable USB Power-Saving",
        {
            "powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0",
            "powercfg /s SCHEME_CURRENT",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\USB\\Parameters\" /v \"DisableSelectiveSuspend\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Disable Hibernate",
        {
            "powercfg /hibernate off",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power\" /v \"HiberbootEnabled\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Disable Sleep Study",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power\" /v \"SleeperEnabled\" /t REG_DWORD /d 0 /f",
            "powercfg /change standby-timeout-ac 0",
            "powercfg /change hibernate-timeout-ac 0",
        }
    },
    {
        "Disable Xbox Game Bar",
        {
            "reg add \"HKCU\\Software\\Microsoft\\GameBar\" /v \"AllowAutoGameMode\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\Software\\Microsoft\\GameBar\" /v \"ShowStartupPanel\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_Enabled\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR\" /v \"AllowGameDVR\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_FSEBehaviorMode\" /t REG_DWORD /d 2 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_HonorUserFSEBehaviorMode\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Disable Windows Telemetry",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection\" /v \"AllowTelemetry\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy\" /v \"TailoredExperiencesWithDiagnosticDataEnabled\" /t REG_DWORD /d 0 /f",
            "sc config \"DiagTrack\" start= disabled",
            "sc stop \"DiagTrack\"",
        }
    },
    {
        "Disable Windows Updates",
        {
            "sc config \"wuauserv\" start= disabled",
            "sc config \"UsoSvc\" start= disabled",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU\" /v \"NoAutoUpdate\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU\" /v \"AUOptions\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Disable Windows Defender",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\" /v \"DisableAntiSpyware\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection\" /v \"DisableBehaviorMonitoring\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection\" /v \"DisableOnAccessProtection\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection\" /v \"DisableScanOnRealtimeEnable\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Interface Tweaks",
        {
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects\" /v \"VisualFXSetting\" /t REG_DWORD /d 2 /f",
            "reg add \"HKCU\\Control Panel\\Desktop\" /v \"DragFullWindows\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Desktop\" /v \"MenuShowDelay\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Desktop\\WindowMetrics\" /v \"MinAnimate\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\" /v \"TaskbarAnimations\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\" /v \"ListviewAlphaSelect\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\DWM\" /v \"EnableAeroPeek\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Storage Tweaks",
        {
            "fsutil behavior set DisableLastAccess 1",
            "fsutil behavior set EncryptPagingFile 0",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters\" /v \"EnablePrefetcher\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters\" /v \"EnableSuperfetch\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\" /v \"NtfsDisable8dot3NameCreation\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "BCDedit Tweaks",
        {
            "bcdedit /set disabledynamictick yes",
            "bcdedit /set useplatformclock false",
            "bcdedit /set tscsyncpolicy enhanced",
            "bcdedit /set bootmenupolicy standard",
            "bcdedit /set nx OptIn",
        }
    },
    {
        "Mouse Tweaks",
        {
            "reg add \"HKCU\\Control Panel\\Mouse\" /v \"MouseSpeed\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Mouse\" /v \"MouseThreshold1\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Mouse\" /v \"MouseThreshold2\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Mouse\" /v \"MouseHoverTime\" /t REG_SZ /d \"0\" /f",
        }
    },
    {
        "Keyboard Tweaks",
        {
            "reg add \"HKCU\\Control Panel\\Keyboard\" /v \"KeyboardDelay\" /t REG_SZ /d \"0\" /f",
            "reg add \"HKCU\\Control Panel\\Keyboard\" /v \"KeyboardSpeed\" /t REG_SZ /d \"31\" /f",
            "reg add \"HKCU\\Control Panel\\Accessibility\\KeyboardResponse\" /v \"AutoRepeatDelay\" /t REG_SZ /d \"250\" /f",
            "reg add \"HKCU\\Control Panel\\Accessibility\\KeyboardResponse\" /v \"AutoRepeatRate\" /t REG_SZ /d \"6\" /f",
        }
    },
    {
        "Kernel Tweaks",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl\" /v \"Win32PrioritySeparation\" /t REG_DWORD /d 38 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel\" /v \"GlobalTimerResolutionRequests\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel\" /v \"DpcWatchdogProfileOffset\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Memory Tweaks",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"LargeSystemCache\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"DisablePagingExecutive\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"ClearPageFileAtShutdown\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v \"IoPageLockLimit\" /t REG_DWORD /d 983040 /f",
        }
    },
    {
        "System Priority Tweaks",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"SystemResponsiveness\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"NetworkThrottlingIndex\" /t REG_DWORD /d 4294967295 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"GPU Priority\" /t REG_DWORD /d 8 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Priority\" /t REG_DWORD /d 6 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Scheduling Category\" /t REG_SZ /d \"High\" /f",
        }
    },
    {
        "CPU Priority for Games",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\csgo.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RainbowSix.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\destiny2.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\EscapeFromTarkov.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        }
    },
    {
        "Smart Optimize",
        {
            // Combined best-of-all in one click
            "powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
            "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100",
            "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100",
            "powercfg /s SCHEME_CURRENT",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"SystemResponsiveness\" /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"GPU Priority\" /t REG_DWORD /d 8 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Priority\" /t REG_DWORD /d 6 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"Scheduling Category\" /t REG_SZ /d \"High\" /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl\" /v \"Win32PrioritySeparation\" /t REG_DWORD /d 38 /f",
            "reg add \"HKCU\\Software\\Microsoft\\GameBar\" /v \"AllowAutoGameMode\" /t REG_DWORD /d 0 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_Enabled\" /t REG_DWORD /d 0 /f",
            "bcdedit /set disabledynamictick yes",
        }
    },
    {
        "Disable Spectre Mitigations",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v FeatureSettingsOverride /t REG_DWORD /d 3 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\" /v FeatureSettingsOverrideMask /t REG_DWORD /d 3 /f",
        }
    },
    {
        "Disable CPU C-States",
        {
            "powercfg /setacvalueindex scheme_current sub_processor IDLEDISABLE 1",
            "powercfg /setacvalueindex scheme_current sub_processor CPMINCORES 100",
            "powercfg /setactive scheme_current",
        }
    },
    {
        "Timer Resolution 1ms",
        {
            "bcdedit /set useplatformclock false",
            "bcdedit /set disabledynamictick yes",
            "bcdedit /set tscsyncpolicy enhanced",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel\" /v GlobalTimerResolutionRequests /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Disable Xbox Services",
        {
            "sc config \"XblAuthManager\" start= disabled",
            "sc config \"XblGameSave\" start= disabled",
            "sc config \"XboxNetApiSvc\" start= disabled",
            "sc config \"TabletInputService\" start= disabled",
            "sc config \"WbioSrvc\" start= disabled",
            "sc config \"WalletService\" start= disabled",
            "sc config \"wisvc\" start= disabled",
            "sc config \"PhoneSvc\" start= disabled",
            "sc config \"SEMgrSvc\" start= disabled",
            "sc config \"lfsvc\" start= disabled",
        }
    },
    {
        "Disable Notifications",
        {
            "reg add \"HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer\" /v DisableNotificationCenter /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\" /v ToastEnabled /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Disable Background Apps",
        {
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications\" /v GlobalUserDisabled /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search\" /v BackgroundAppGlobalToggle /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Disable Cortana & Search",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search\" /v AllowCortana /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search\" /v DisableWebSearch /t REG_DWORD /d 1 /f",
            "sc config \"WSearch\" start= disabled",
            "sc stop \"WSearch\"",
        }
    },
    {
        "Disable BSOD Auto Restart",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\CrashControl\" /v AutoReboot /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\CrashControl\" /v CrashDumpEnabled /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Power Throttling Disable",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling\" /v PowerThrottlingOff /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Disable Remote Access",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Remote Assistance\" /v fAllowToGetHelp /t REG_DWORD /d 0 /f",
            "sc config \"RemoteRegistry\" start= disabled",
            "sc config \"RemoteAccess\" start= disabled",
        }
    },
    {
        "Disable Auto Maintenance",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\Maintenance\" /v MaintenanceDisabled /t REG_DWORD /d 1 /f",
        }
    },
};

// ─── Network Tweaks ───────────────────────────────────────────────────────
std::vector<TweakGroup> g_networkTweaks = {
    {
        "Optimize TCP/IP Stack",
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
        "Flush DNS & Reset Winsock",
        {
            "ipconfig /flushdns",
            "ipconfig /registerdns",
            "netsh winsock reset",
            "netsh int ip reset",
        }
    },
    {
        "Set Cloudflare DNS 1.1.1.1",
        {
            "netsh interface ip set dns name=\"Ethernet\" static 1.1.1.1",
            "netsh interface ip add dns name=\"Ethernet\" addr=1.0.0.1 index=2",
            "netsh interface ip set dns name=\"Wi-Fi\" static 1.1.1.1",
            "netsh interface ip add dns name=\"Wi-Fi\" addr=1.0.0.1 index=2",
        }
    },
    {
        "Disable Network Throttling",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\" /v \"NetworkThrottlingIndex\" /t REG_DWORD /d 0xffffffff /f",
            "netsh int tcp set global initialRto=2000",
            "netsh int tcp set global minRto=300",
        }
    },
    {
        "Remove QoS Bandwidth Limit",
        {
            "reg add \"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched\" /v \"NonBestEffortLimit\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "Disable Nagle Algorithm",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\" /v \"TcpAckFrequency\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\" /v \"TCPNoDelay\" /t REG_DWORD /d 1 /f",
        }
    },
    {
        "Low Latency TCP",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\" /v DefaultTTL /t REG_DWORD /d 64 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\" /v MaxUserPort /t REG_DWORD /d 65534 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\" /v TcpTimedWaitDelay /t REG_DWORD /d 30 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\" /v Tcp1323Opts /t REG_DWORD /d 1 /f",
            "netsh int tcp set global fastopen=enabled",
            "netsh int tcp set global rss=enabled",
        }
    },
    {
        "Disable IPv6",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\" /v DisabledComponents /t REG_DWORD /d 255 /f",
            "netsh interface ipv6 set global randomizeidentifiers=disabled",
        }
    },
};

// ─── GPU Tweaks ───────────────────────────────────────────────────────────
std::vector<TweakGroup> g_gpuTweaks = {
    {
        "Enable HAGS",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\" /v \"HwSchMode\" /t REG_DWORD /d 2 /f",
        }
    },
    {
        "Disable Xbox Overlay",
        {
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_FSEBehaviorMode\" /t REG_DWORD /d 2 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_HonorUserFSEBehaviorMode\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_DXGIHonorFSEWindowsCompatible\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\System\\GameConfigStore\" /v \"GameDVR_Enabled\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "DirectX 12 & Shader Cache",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\DirectX\" /v \"D3D12_ALLOW_TEARING\" /t REG_DWORD /d 1 /f",
            "reg add \"HKCU\\SOFTWARE\\Microsoft\\Direct3D\" /v \"ForceLatentSwapChain\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "NVIDIA Registry Tweaks",
        {
            "reg add \"HKCU\\SOFTWARE\\NVIDIA Corporation\\Global\\NVTweak\" /v \"Anisotropic\" /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SOFTWARE\\NVIDIA Corporation\\Global\\Startup\" /v \"SendTelemetryData\" /t REG_DWORD /d 0 /f",
        }
    },
    {
        "GPU Scheduling Priority",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\" /v \"TdrDelay\" /t REG_DWORD /d 10 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\" /v \"TdrDdiDelay\" /t REG_DWORD /d 10 /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games\" /v \"GPU Priority\" /t REG_DWORD /d 8 /f",
        }
    },
    {
        "Disable GPU Preemption",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\Scheduler\" /v EnablePreemption /t REG_DWORD /d 0 /f",
        }
    },
    {
        "CPU Core Unparking",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\0cc5b647-c1df-4637-891a-dec35c318583\" /v ValueMax /t REG_DWORD /d 100 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\0cc5b647-c1df-4637-891a-dec35c318583\" /v ValueMin /t REG_DWORD /d 100 /f",
            "powercfg /setacvalueindex scheme_current 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 100",
            "powercfg /setactive scheme_current",
        }
    },
    {
        "USB Polling Rate 1ms",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\USBPORT\\Parameters\" /v IdleEnable /t REG_DWORD /d 0 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\HidUsb\\Parameters\" /v PollInterval /t REG_DWORD /d 1 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters\" /v MouseDataQueueSize /t REG_DWORD /d 20 /f",
        }
    },
    {
        "DPC Latency Tweaks",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel\" /v DpcWatchdogProfileOffset /t REG_DWORD /d 0 /f",
            "bcdedit /set disabledynamictick yes",
            "bcdedit /set useplatformclock false",
        }
    },
    {
        "Low Latency Audio",
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Audio\" /v \"Scheduling Category\" /t REG_SZ /d \"Medium\" /f",
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Capture\" /v \"Scheduling Category\" /t REG_SZ /d \"High\" /f",
        }
    },
    {
        "Disable CPU PPM Driver",
        {
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\intelppm\" /v Start /t REG_DWORD /d 4 /f",
            "reg add \"HKLM\\SYSTEM\\CurrentControlSet\\Services\\amdppm\" /v Start /t REG_DWORD /d 4 /f",
        }
    },
};

// ─── Game Tweaks ──────────────────────────────────────────────────────────
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
    {
        "CS2", "CS2",
        "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\cs2.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        {},
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\cs2.exe\\PerfOptions\" /v \"IoPriority\" /t REG_DWORD /d 3 /f",
        }
    },
    {
        "Apex Legends", "APX",
        "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\r5apex.exe\\PerfOptions\" /v \"CpuPriorityClass\" /t REG_DWORD /d 3 /f",
        {},
        {
            "reg add \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\r5apex.exe\\PerfOptions\" /v \"IoPriority\" /t REG_DWORD /d 3 /f",
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

bool RegSetDWORD(HKEY root, const std::string& subKey,
                 const std::string& valueName, DWORD data)
{
    HKEY hk;
    if (RegCreateKeyExA(root, subKey.c_str(), 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr, &hk, nullptr) != ERROR_SUCCESS)
        return false;
    bool ok = RegSetValueExA(hk, valueName.c_str(), 0, REG_DWORD,
                              (const BYTE*)&data, sizeof(data)) == ERROR_SUCCESS;
    RegCloseKey(hk);
    return ok;
}

bool RegSetSZ(HKEY root, const std::string& subKey,
              const std::string& valueName, const std::string& data)
{
    HKEY hk;
    if (RegCreateKeyExA(root, subKey.c_str(), 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr, &hk, nullptr) != ERROR_SUCCESS)
        return false;
    bool ok = RegSetValueExA(hk, valueName.c_str(), 0, REG_SZ,
                              (const BYTE*)data.c_str(),
                              (DWORD)(data.size() + 1)) == ERROR_SUCCESS;
    RegCloseKey(hk);
    return ok;
}

bool ConfigureService(const std::string& serviceName, DWORD startType) {
    SC_HANDLE scm = OpenSCManagerA(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (!scm) return false;
    SC_HANDLE svc = OpenServiceA(scm, serviceName.c_str(), SERVICE_CHANGE_CONFIG | SERVICE_STOP);
    if (!svc) { CloseServiceHandle(scm); return false; }
    ControlService(svc, SERVICE_CONTROL_STOP, nullptr);
    bool ok = ChangeServiceConfigA(svc, SERVICE_NO_CHANGE, startType,
                                   SERVICE_NO_CHANGE, nullptr, nullptr, nullptr,
                                   nullptr, nullptr, nullptr, nullptr) != 0;
    CloseServiceHandle(svc);
    CloseServiceHandle(scm);
    return ok;
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
            log(std::string(ok ? "  [OK] " : "  [!!] ") + cmd.substr(0, 80), ok);
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
    size_t steps = game.files.size() + game.extraCmds.size() + 2;
    size_t done  = 0;

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
        log(std::string(code == 0 ? "  [OK] " : "  [!!] ") + "CPU priority set", code == 0);
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
    log("========  ULTRA OPTIMIZE  ========", true);

    std::atomic<float> p1 = 0.f;
    ApplyTweakGroups(g_systemTweaks, p1, log);
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
    log("========  DONE — Restart your PC  ========", true);
}

void CleanTempFiles(std::atomic<float>& progress, LogCallback log)
{
    log(">> Cleaning temporary files", true);
    std::vector<std::string> cmds = {
        "del /f /s /q \"%TEMP%\\*\"",
        "del /f /s /q \"C:\\Windows\\Temp\\*\"",
        "del /f /s /q \"C:\\Windows\\Prefetch\\*\"",
        "del /f /s /q \"%LOCALAPPDATA%\\Temp\\*\"",
    };
    for (size_t i = 0; i < cmds.size(); i++)
    {
        RunShellCmd(cmds[i]);
        log("  [OK] Cleaned: " + cmds[i].substr(10, 40), true);
        progress.store((float)(i + 1) / (float)cmds.size());
    }
}
