local OutputPath = assert(arg[1], "output path is required")
local ScriptRoot = assert(arg[2], "script root is required")
package.path = ScriptRoot .. "/?.lua;" .. package.path

local function NewEvent()
    local Event = {Listeners = {}}
    function Event:Add(Func, Object, RawData)
        table.insert(self.Listeners, {Func = Func, Object = Object, RawData = RawData})
    end
    function Event:Bingo(Args)
        for _, Listener in ipairs(self.Listeners) do
            Listener.Func(Listener.Object, Args, Listener.RawData)
        end
    end
    return Event
end

local Pending = {}
local TimerHandle = {}
function TimerHandle:DelayCall(Host, Func)
    table.insert(Pending, {Host = Host, Func = Func})
    return #Pending
end
function TimerHandle.RunAll()
    local Work = Pending
    Pending = {}
    for _, Item in ipairs(Work) do
        Item.Func(Item.Host)
    end
end

local AutoMoveManager = {
    AutoMoveStartEvent = NewEvent(),
    AutoMoveEndEvent = NewEvent(),
    AutoMoveInfo = {MapID = 2001},
}

local DialogManager = {
    HandleDialogEvent = NewEvent(),
    ProcessDialogEvent = NewEvent(),
    EndDialogEvent = NewEvent(),
    TaskID = 100101,
    TaskLineId = 1001,
}
function DialogManager.IsDuringDialog()
    return true
end
function DialogManager:GetStartDialogID()
    return 400100
end
function DialogManager:GetDialogID()
    return 400103
end

local NavigationGuideManager = {
    PostAddPathEvent = NewEvent(),
    PostRemovePathEvent = NewEvent(),
    PostRefreshMovePathEvent = NewEvent(),
}
function NavigationGuideManager:GetLastPath()
    return {
        GetEndNavigationGuideData = function()
            return {
                SourceType = 1,
                SourceId = 100101,
                MapId = 2001,
                TargetType = 2,
                TargetId = 3001,
            }
        end
    }
end

package.preload["Utils.TimerHandle"] = function()
    return TimerHandle
end
package.preload["Manager.GameManager"] = function()
    return {
        GetTimeManager = function()
            return {Now = function() return 123456 end}
        end
    }
end
package.preload["Manager.AutoMoveManager"] = function()
    return AutoMoveManager
end
package.preload["Manager.DialogManager"] = function()
    return DialogManager
end
package.preload["UI.NavigationGuide.NavigationGuideManager"] = function()
    return NavigationGuideManager
end
package.preload["Protocols.ProtoLua.game.taskModule.TaskStatus"] = function()
    return {
        Create = function()
            return {
                NONE_ = 0,
                ABANDON = -1,
                PROCESSING = 1,
                FINISHED = 2,
                COMMITTED = 3,
                FAILED = 4,
            }
        end
    }
end

SeriaCfg = {
    Mission = {
        [100101] = {Name = "主线任务", Description = "到达目标区域", Subtask = "100102,100103"},
        [100102] = {Name = "候选任务A", Description = "", Subtask = ""},
        [100103] = {Name = "候选任务B", Description = "", Subtask = ""},
    }
}
ENavigationGuideSourceType = {ETask = 1}
UE4 = {
    UKismetSystemLibrary = {
        GetProjectSavedDirectory = function()
            return "ignored/"
        end
    },
    USeriaLuaInterface = {
        SaveStringToFile = function(Content)
            local File = assert(io.open(OutputPath, "wb"))
            assert(File:write(Content))
            File:close()
            return true
        end
    }
}
function Error(...)
    io.stderr:write(table.concat({...}, " "), "\n")
end

local TaskManager = {
    OnAcceptTaskEvent = NewEvent(),
    RemoveTaskEvent = NewEvent(),
    FinishTaskEvent = NewEvent(),
    ActiveTaskEvent = NewEvent(),
    DeactiveTaskEvent = NewEvent(),
    OnRefreshTaskEvent = NewEvent(),
    OnHandleTaskEvent = NewEvent(),
    OnTraceTaskEvent = NewEvent(),
    OnTaskLineFinishedEvent = NewEvent(),
    OnTaskListInitedEvent = NewEvent(),
    TaskLineStateChangeEvent = NewEvent(),
    AllNPCRemoveTaskEvent = NewEvent(),
    CurrentTaskList = {
        Server = {{
            TaskID = 100101,
            Status = 1,
            TaskType = 1,
            MType = 2,
            Value = 3,
            bActive = true,
            IsSubTask = false,
            bParallel = false,
            bAutoNext = false,
        }},
        Client = {},
    },
    TracedTaskLines = {[1] = 1001},
    NextIndexesByTaskID = {},
    bReceiveTaskList = true,
    bInitTaskList = false,
}
function TaskManager.GetTaskList()
    return TaskManager.CurrentTaskList.Server
end
function TaskManager.GetTasklineID(TaskId)
    return math.floor(TaskId / 100)
end
function TaskManager.IsTaskTraced(TaskId)
    return TaskManager.TracedTaskLines[1] == TaskManager.GetTasklineID(TaskId)
end
function TaskManager.HandleNameText(TaskId, UseDescription)
    local Row = SeriaCfg.Mission[TaskId]
    return UseDescription and Row.Description or Row.Name
end
function TaskManager.SplitSubtask(Value)
    local Result = {}
    for Token in string.gmatch(Value or "", "[^,]+") do
        local Number = tonumber(Token)
        if Number then
            table.insert(Result, Number)
        end
    end
    return Result, {}
end

local Diagnostics = require "UI.Task.TaskQADiagnostics"
Diagnostics.Init(TaskManager)
TimerHandle.RunAll()

TaskManager.CurrentTaskList.Server[1].Status = 2
TaskManager.OnRefreshTaskEvent:Bingo(TaskManager.CurrentTaskList.Server[1])
TimerHandle.RunAll()

TaskManager.CurrentTaskList.Server[1].Status = 1
TaskManager.OnHandleTaskEvent:Bingo(100101)
TimerHandle.RunAll()

print("Lua snapshot integration test passed.")
