# Eminence Tweak — Build Instructions

## Requirements
- Windows 10/11 (x64)
- [Visual Studio 2022](https://visualstudio.microsoft.com/) with **Desktop development with C++** workload
- [CMake 3.20+](https://cmake.org/download/) (bundled with VS or standalone)
- Git (to fetch ImGui automatically)

## Build (Visual Studio)

```bat
git clone https://github.com/yourrepo/eminence-tweak.git
cd eminence-tweak

cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

The binary lands in `bin\EminenceTweak.exe`.

## Build (MSVC CLI / Ninja)

```bat
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

## Run

Right-click `EminenceTweak.exe` → **Run as administrator**
(The manifest requests elevation automatically on Windows 10/11.)

## Notes

- All tweaks run **only on Windows**; the app will not compile on Linux/macOS.
- ImGui v1.91.6 is fetched automatically via `FetchContent` at configure time.
- No third-party DLLs required — fully static, single `.exe` output.
