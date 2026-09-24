local OutputPath = assert(arg[1], "output path is required")
local ScriptRoot = assert(arg[2], "script root is required")
local DiagnosticsPath = assert(arg[3], "diagnostics source path is required")
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

local StartDialogId = 400100
local CurrentDialogId = 400103
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
    return StartDialogId
end
function DialogManager:GetDialogID()
    return CurrentDialogId
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
package.preload["UI.Task.TaskQADiagnostics"] = function()
    return assert(loadfile(DiagnosticsPath))()
end

SeriaCfg = {
    Mission = {
        [100100] = {Name = "前置任务", Description = "", Subtask = "100101"},
        [100101] = {Name = "主线任务", Description = "到达目标区域", Subtask = "100102,100103"},
        [100102] = {Name = "候选任务A", Description = "", Subtask = ""},
        [100103] = {Name = "候选任务B", Description = "", Subtask = ""},
    },
    DialogStart = {
        [400100] = {Virtual = true},
        [400200] = {Virtual = false},
    },
    ComplexChat = {
        [400200] = {},
    },
}
local BranchTaskIds = {}
for TaskId = 100102, 100120 do
    if not SeriaCfg.Mission[TaskId] then
        SeriaCfg.Mission[TaskId] = {
            Name = "候选任务" .. tostring(TaskId),
            Description = "",
            Subtask = "",
        }
    end
    table.insert(BranchTaskIds, tostring(TaskId))
end
SeriaCfg.Mission[100101].Subtask = table.concat(BranchTaskIds, ",")
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
    TaskStatusReceivedEvent = NewEvent(),
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
    QueryTaskMap = {
        [100102] = 0,
    },
    QueriedTaskIds = {},
    QueryCallCount = 0,
    bReceiveTaskList = true,
    bInitTaskList = false,
}
function TaskManager.GetTaskList()
    return TaskManager.CurrentTaskList.Server
end
function TaskManager.GetTasklineID(TaskId)
    return math.floor(TaskId / 100)
end
function TaskManager.GetFirstTaskIDOfTaskLine()
    return 100100
end
function TaskManager.GetTaskStatusById(TaskId)
    return TaskManager.QueryTaskMap[TaskId]
end
function TaskManager.AddQueryTaskStatus(TaskIds)
    TaskManager.QueryCallCount = TaskManager.QueryCallCount + 1
    for _, TaskId in ipairs(TaskIds) do
        TaskManager.QueriedTaskIds[TaskId] = true
        TaskManager.QueryTaskMap[TaskId] = 0
    end
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

local function ReadSnapshot()
    local File = assert(io.open(OutputPath, "rb"))
    local Content = File:read("*a")
    File:close()
    return Content
end

local function FindDialogueRecord(Content)
    for Line in string.gmatch(Content, "[^\n]+") do
        local Active, StartId, CurrentId, TaskId, TaskLineId, ComplexChat, CameraDialog =
            string.match(Line,
                "^DIALOG\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)$")
        if Active then
            return {
                Active = Active,
                StartId = StartId,
                CurrentId = CurrentId,
                TaskId = TaskId,
                TaskLineId = TaskLineId,
                ComplexChat = ComplexChat,
                CameraDialog = CameraDialog,
            }
        end
    end
    error("DIALOG record was not emitted")
end

local Diagnostics = require "UI.Task.TaskQADiagnostics"
Diagnostics.Init(TaskManager)
TimerHandle.RunAll()

local CameraDialogue = FindDialogueRecord(ReadSnapshot())
assert(CameraDialogue.StartId == "400100", "camera dialogue start id")
assert(CameraDialogue.ComplexChat == "0", "camera dialogue complex flag")
assert(CameraDialogue.CameraDialog == "1", "camera dialogue virtual flag")

StartDialogId = 400200
CurrentDialogId = 400203
DialogManager.ProcessDialogEvent:Bingo({})
TimerHandle.RunAll()

local ComplexDialogue = FindDialogueRecord(ReadSnapshot())
assert(ComplexDialogue.StartId == "400200", "complex chat start id")
assert(ComplexDialogue.ComplexChat == "1", "complex chat flag")
assert(ComplexDialogue.CameraDialog == "0", "complex chat camera flag")

TaskManager.QueryTaskMap[100103] = 2
TaskManager.TaskStatusReceivedEvent:Bingo({TaskMap = {[100103] = 2}})
TimerHandle.RunAll()

TaskManager.CurrentTaskList.Server[1].Status = 2
TaskManager.OnRefreshTaskEvent:Bingo(TaskManager.CurrentTaskList.Server[1])
TimerHandle.RunAll()

TaskManager.CurrentTaskList.Server[1].Status = 1
TaskManager.OnHandleTaskEvent:Bingo(100101)
TimerHandle.RunAll()

local Content = ReadSnapshot()
local FoundProgress = false
local NodeStatusById = {}
for Line in string.gmatch(Content, "[^\n]+") do
    local ProgressBody = string.match(Line, "^PROGRESS\t(.+)$")
    if ProgressBody then
        FoundProgress = true
        local TaskId, _, Completed, Remaining, Total, HasBranches, Known =
            string.match(ProgressBody, "^(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)$")
        assert(TaskId == "100101", "progress task id")
        assert(Completed == "1", "progress completed nodes")
        assert(Remaining == "19", "progress remaining nodes")
        assert(Total == "21", "progress total nodes")
        assert(HasBranches == "1", "progress branch flag")
        assert(Known == "1", "progress known flag")
    end
    local LineId, TaskId, _, Depth, Order, Status, Held, SelectedPath, Branch,
        StatusInferred, SubTaskEdge =
        string.match(Line,
            "^NODE\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t([%-]?%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t(%d+)\t")
    if LineId then
        NodeStatusById[TaskId] = {
            LineId = LineId,
            Depth = Depth,
            Order = Order,
            Status = Status,
            Held = Held,
            SelectedPath = SelectedPath,
            Branch = Branch,
            StatusInferred = StatusInferred,
            SubTaskEdge = SubTaskEdge,
        }
    end
end
assert(FoundProgress, "PROGRESS record was emitted")
assert(NodeStatusById["100100"].Status == "2", "completed task node status")
assert(NodeStatusById["100100"].StatusInferred == "1", "completed task node inference")
assert(NodeStatusById["100101"].Status == "1", "held task node status")
assert(NodeStatusById["100101"].Held == "1", "held task node flag")
assert(NodeStatusById["100102"].Status == "0", "future task node status")
assert(NodeStatusById["100103"].Status == "2", "queried task node status")
assert(TaskManager.QueryCallCount == 0, "collector must not query task status")

print("Lua snapshot integration test passed.")
