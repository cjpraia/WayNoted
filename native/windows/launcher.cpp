// Bundled CLI/MCP launcher. No shell, Node installation, or machine-wide environment changes.
#include <windows.h>
#include <filesystem>
#include <string>
static std::wstring quote(const std::wstring& value) {
    std::wstring out = L"\""; size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { slashes++; continue; }
        if (c == L'"') { out.append(slashes * 2 + 1, L'\\'); out += c; }
        else { out.append(slashes, L'\\'); out += c; }
        slashes = 0;
    }
    out.append(slashes * 2, L'\\'); return out + L'"';
}
int wmain(int argc, wchar_t** argv) {
    wchar_t own[32768]; DWORD length = GetModuleFileNameW(nullptr, own, 32768);
    if (!length || length == 32768) return 127;
    auto root = std::filesystem::path(own).parent_path().parent_path().parent_path();
    auto executable = root / L"Desktop.exe";
    auto source = root / L"resources" / L"app.asar" / L"electron" / L"cli.cjs";
    if (!std::filesystem::exists(root / L"resources" / L"app.asar")) source = root / L"resources" / L"app" / L"electron" / L"cli.cjs";
    if (!std::filesystem::exists(executable)) return 127;
    std::wstring command = quote(executable.wstring()) + L" " + quote(source.wstring());
    for (int i = 1; i < argc; i++) command += L" " + quote(argv[i]);
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE, GetConsoleWindow() ? 0 : CREATE_NO_WINDOW, nullptr, root.c_str(), &startup, &process)) return 127;
    WaitForSingleObject(process.hProcess, INFINITE); DWORD code = 1; GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess); return static_cast<int>(code);
}
