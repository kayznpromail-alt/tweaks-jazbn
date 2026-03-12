#pragma once
#include <atomic>
#include <string>
#include <vector>
#include <functional>
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

// ─── Result of a single tweak command ─────────────────────────────────────
struct TweakResult {
    std::string label;
    bool        success;
    std::string detail;
};

// ─── A group of registry/shell commands ──────────────────────────────────
struct TweakGroup {
    std::string              name;
    std::vector<std::string> cmds;
};

// ─── Game config file + registry tweaks ──────────────────────────────────
struct GameFileTweak {
    std::string envPath;   // e.g. "%LOCALAPPDATA%\FortniteGame\..."
    std::string content;
};

struct GameTweak {
    std::string                  name;
    std::string                  tag;       // short id
    std::string                  priorityCmd;
    std::vector<GameFileTweak>   files;
    std::vector<std::string>     extraCmds;
};

// ─── Tweak catalogues ──────────────────────────────────────────────────────
extern std::vector<TweakGroup> g_systemTweaks;
extern std::vector<TweakGroup> g_networkTweaks;
extern std::vector<TweakGroup> g_gpuTweaks;
extern std::vector<GameTweak>  g_gameTweaks;

// ─── Execution helpers ────────────────────────────────────────────────────
// Run a cmd.exe command, return {exit_code, combined_output}
std::pair<int, std::string> RunShellCmd(const std::string& cmd);

// Set a DWORD registry value, returns true on success
bool RegSetDWORD(HKEY root, const std::string& subKey,
                 const std::string& valueName, DWORD data);

// Set a SZ registry value, returns true on success
bool RegSetSZ(HKEY root, const std::string& subKey,
              const std::string& valueName, const std::string& data);

// Disable/configure a Windows service
bool ConfigureService(const std::string& serviceName, DWORD startType);

// Write a UTF-8 file, creating parent dirs as needed
bool WriteConfigFile(const std::string& envPath, const std::string& content);

// Expand %ENV% variables in a path
std::string ExpandEnvPath(const std::string& path);

// ─── High-level apply functions ────────────────────────────────────────────
using LogCallback = std::function<void(const std::string&, bool ok)>;

void ApplyTweakGroups(const std::vector<TweakGroup>& groups,
                      std::atomic<float>& progress,
                      LogCallback log);

void ApplyGameTweak(const GameTweak& game,
                    std::atomic<float>& progress,
                    LogCallback log);

void ApplyAllTweaks(std::atomic<float>& progress, LogCallback log);

void CleanTempFiles(std::atomic<float>& progress, LogCallback log);
