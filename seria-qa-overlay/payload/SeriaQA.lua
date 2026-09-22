local ModuleName = "UI.Task.TaskQADiagnostics"
local Diagnostics = package.loaded[ModuleName]
if type(Diagnostics) ~= "table" then
    local BinariesDir = UE4.USeriaLuaInterface.GetProjectBinariesDirectory()
    local Loader, LoadError = loadfile(BinariesDir .. "/TaskQADiagnostics.lua")
    if type(Loader) ~= "function" then
        Error("[SeriaQA] Failed to load TaskQADiagnostics.lua:", LoadError)
        return
    end

    Diagnostics = Loader()
    package.loaded[ModuleName] = Diagnostics
end
if type(Diagnostics) ~= "table" or type(Diagnostics.Init) ~= "function" then
    Error("[SeriaQA] TaskQADiagnostics.lua did not return a valid producer")
    return
end

_G.SeriaQADiagnostics = Diagnostics
Diagnostics.Init(require "UI.Task.TaskManager")
LogMark("[SeriaQA] Runtime task capture activated")
