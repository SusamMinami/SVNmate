local BootstrapPath = assert(arg[1], "bootstrap path is required")
local Initialized = false
local LoadedDiagnostics

UE4 = {
    USeriaLuaInterface = {
        GetProjectBinariesDirectory = function()
            return "mock"
        end,
    },
}

loadfile = function(Path)
    assert(Path == "mock/TaskQADiagnostics.lua")
    return function()
        LoadedDiagnostics = {
            Init = function(TaskManager)
                assert(TaskManager.Ready)
                Initialized = true
            end,
        }
        return LoadedDiagnostics
    end
end

package.preload["UI.Task.TaskManager"] = function()
    return {Ready = true}
end
LogMark = function() end

dofile(BootstrapPath)
assert(Initialized, "bootstrap did not initialize task diagnostics")
assert(SeriaQADiagnostics == LoadedDiagnostics, "bootstrap did not retain a global reference")
assert(package.loaded["UI.Task.TaskQADiagnostics"] == LoadedDiagnostics,
    "bootstrap did not retain the module reference")
print("Runtime Lua bootstrap test passed.")
