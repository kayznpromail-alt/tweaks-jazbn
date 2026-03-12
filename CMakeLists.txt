cmake_minimum_required(VERSION 3.20)
project(EminenceTweak CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── Only Windows is supported ────────────────────────────────────────────
if(NOT WIN32)
    message(FATAL_ERROR "Eminence Tweak is a Windows-only application.")
endif()

# ─── Fetch Dear ImGui ─────────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
    imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG        v1.91.6
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(imgui)

# ─── Fetch stb (stb_image) ────────────────────────────────────────────────
FetchContent_Declare(
    stb
    GIT_REPOSITORY https://github.com/nothings/stb.git
    GIT_TAG        master
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(stb)

# ─── ImGui sources ────────────────────────────────────────────────────────
set(IMGUI_SOURCES
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_win32.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_dx11.cpp
)

set(IMGUI_INCLUDES
    ${imgui_SOURCE_DIR}
    ${imgui_SOURCE_DIR}/backends
)

# ─── App sources ──────────────────────────────────────────────────────────
set(APP_SOURCES
    src/main.cpp
    src/tweaks.cpp
)

# ─── Executable (Win32 subsystem — no console window) ─────────────────────
add_executable(EminenceTweak WIN32
    ${APP_SOURCES}
    ${IMGUI_SOURCES}
)

target_include_directories(EminenceTweak PRIVATE
    ${IMGUI_INCLUDES}
    ${stb_SOURCE_DIR}
    src
)

# ─── Windows libs ─────────────────────────────────────────────────────────
target_link_libraries(EminenceTweak PRIVATE
    d3d11
    dxgi
    dwmapi
    shell32
    shlwapi
    advapi32
)

# ─── Compiler flags ───────────────────────────────────────────────────────
if(MSVC)
    target_compile_options(EminenceTweak PRIVATE
        /W3 /WX-
        /MP             # parallel compilation
        /O2             # full optimisation
        /GL             # whole-program optimisation
        /GS-            # disable buffer security check (perf)
        /utf-8
    )
    target_link_options(EminenceTweak PRIVATE
        /LTCG           # link-time code generation
        /SUBSYSTEM:WINDOWS
        /MANIFEST:NO
    )
    # Request admin elevation via manifest
    set_target_properties(EminenceTweak PROPERTIES
        VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        LINK_FLAGS "/MANIFESTUAC:\"level='requireAdministrator' uiAccess='false'\""
    )
elseif(MINGW)
    target_compile_options(EminenceTweak PRIVATE -O2 -Wall)
    target_link_options(EminenceTweak PRIVATE -mwindows)
endif()

# ─── Output directory ─────────────────────────────────────────────────────
set_target_properties(EminenceTweak PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/bin"
)

message(STATUS "")
message(STATUS "  ╔═══════════════════════════════════════╗")
message(STATUS "  ║   EMINENCE TWEAK — Build configured   ║")
message(STATUS "  ║   cmake --build . --config Release    ║")
message(STATUS "  ╚═══════════════════════════════════════╝")
message(STATUS "")
