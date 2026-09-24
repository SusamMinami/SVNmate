local TaskQADiagnostics = {}

local TimerHandle = require "Utils.TimerHandle"
local GameManager = require "Manager.GameManager"
local AutoMoveManager = require "Manager.AutoMoveManager"
local DialogManager = require "Manager.DialogManager"
local NavigationGuideManager = require "UI.NavigationGuide.NavigationGuideManager"
local TaskStatus = require "Protocols.ProtoLua.game.taskModule.TaskStatus".Create()

local TaskCfg = SeriaCfg.Mission
local DialogStartCfg = SeriaCfg.DialogStart or {}
local ComplexChatCfg = SeriaCfg.ComplexChat or {}

local SchemaVersion = 6
local SnapshotPrefix = "SeriaQAOverlay."
local MaxEvents = 64
local MaxProgressNodes = 4096
local MaxTaskNodes = 1024

local StatusNames = {
    [TaskStatus.NONE_] = "none",
    [TaskStatus.ABANDON] = "abandon",
    [TaskStatus.PROCESSING] = "processing",
    [TaskStatus.FINISHED] = "finished",
    [TaskStatus.COMMITTED] = "committed",
    [TaskStatus.FAILED] = "failed",
}

local function BoolText(Value)
    return Value and "1" or "0"
end

local function SafeNumber(Value)
    return tonumber(Value) or 0
end

local function EscapeField(Value)
    if Value == nil then
        return ""
    end

    local Text = tostring(Value)
    Text = string.gsub(Text, "%%", "%%25")
    Text = string.gsub(Text, "\t", "%%09")
    Text = string.gsub(Text, "\r", "%%0D")
    Text = string.gsub(Text, "\n", "%%0A")
    return Text
end

local function JoinNumbers(Values)
    local Result = {}
    for _, Value in ipairs(Values or {}) do
        table.insert(Result, tostring(SafeNumber(Value)))
    end
    return table.concat(Result, ",")
end

local function GetNowMs()
    local TimeManager = GameManager and GameManager:GetTimeManager()
    if TimeManager then
        return math.floor(SafeNumber(TimeManager:Now()))
    end
    return os.time() * 1000
end

local function GetTaskLineId(TaskManager, TaskId)
    local Success, Result = pcall(TaskManager.GetTasklineID, TaskId)
    return Success and SafeNumber(Result) or 0
end

local function ResolveTaskText(TaskManager, TaskId, UseDescription)
    local Success, Text = pcall(TaskManager.HandleNameText, TaskId, UseDescription)
    if Success and Text ~= nil then
        return tostring(Text)
    end

    local Row = TaskCfg[TaskId]
    if not Row then
        return ""
    end
    return tostring(UseDescription and Row.Description or Row.Name or "")
end

local function ResolveStaticTaskName(TaskId)
    local Row = TaskCfg[TaskId]
    return Row and tostring(Row.Name or "") or ""
end

local function IsCountedTask(TaskId)
    local Row = TaskCfg[TaskId]
    return Row and (tostring(Row.Name or "") ~= "" or tostring(Row.Description or "") ~= "")
end

-- Resolves configured successors/subtasks on one task, honoring the player's
-- selected branch indexes and reporting whether unresolved branches remain.
local function ResolveLinks(TaskManager, TaskId, Row)
    local NextTaskIds, SubTaskIds = TaskManager.SplitSubtask(Row.Subtask)
    local HasBranches = false
    local SelectedIndexes = TaskManager.NextIndexesByTaskID[TaskId]
    if SelectedIndexes and #SelectedIndexes > 0 then
        local SelectedTaskIds = {}
        for _, Index in ipairs(SelectedIndexes) do
            if NextTaskIds[Index] then
                table.insert(SelectedTaskIds, NextTaskIds[Index])
            end
        end
        NextTaskIds = SelectedTaskIds
    elseif #NextTaskIds > 1 then
        HasBranches = true
    end
    if #SubTaskIds > 1 then
        HasBranches = true
    end
    return NextTaskIds, SubTaskIds, HasBranches
end

local function GetTaskRecord(TaskManager, TaskInfo, Source, ShownTaskIds)
    local TaskId = SafeNumber(TaskInfo.TaskID)
    return {
        TaskId = TaskId,
        TaskLineId = GetTaskLineId(TaskManager, TaskId),
        Status = SafeNumber(TaskInfo.Status),
        TaskClass = SafeNumber(TaskInfo.TaskType),
        MType = SafeNumber(TaskInfo.MType),
        Value = SafeNumber(TaskInfo.Value),
        Active = TaskInfo.bActive == true,
        Traced = TaskManager.IsTaskTraced(TaskId) == true,
        Shown = ShownTaskIds[TaskId] == true,
        Client = Source == "client",
        SubTask = TaskInfo.IsSubTask == true,
        Parallel = TaskInfo.bParallel == true,
        AutoNext = TaskInfo.bAutoNext == true,
        Name = ResolveTaskText(TaskManager, TaskId, false),
        Description = ResolveTaskText(TaskManager, TaskId, true),
    }
end

local function BuildShownTaskMap(TaskManager)
    local Result = {}
    local Success, TaskList = pcall(TaskManager.GetTaskList)
    if Success and TaskList then
        for _, TaskInfo in ipairs(TaskList) do
            if TaskInfo and TaskInfo.TaskID then
                Result[TaskInfo.TaskID] = true
            end
        end
    end
    return Result
end

local function BuildTaskRecords(TaskManager)
    local Records = {}
    local Counts = {Server = 0, Client = 0}
    local ShownTaskIds = BuildShownTaskMap(TaskManager)

    for _, SourceInfo in ipairs({
        {Name = "server", Items = TaskManager.CurrentTaskList and TaskManager.CurrentTaskList.Server},
        {Name = "client", Items = TaskManager.CurrentTaskList and TaskManager.CurrentTaskList.Client},
    }) do
        for _, TaskInfo in ipairs(SourceInfo.Items or {}) do
            if TaskInfo and TaskInfo.TaskID then
                table.insert(Records, GetTaskRecord(TaskManager, TaskInfo, SourceInfo.Name, ShownTaskIds))
                Counts[SourceInfo.Name == "server" and "Server" or "Client"] =
                    Counts[SourceInfo.Name == "server" and "Server" or "Client"] + 1
            end
        end
    end

    table.sort(Records, function(A, B)
        if A.Traced ~= B.Traced then
            return A.Traced
        end
        if A.SubTask ~= B.SubTask then
            return not A.SubTask
        end
        if A.TaskLineId ~= B.TaskLineId then
            return A.TaskLineId < B.TaskLineId
        end
        return A.TaskId < B.TaskId
    end)

    return Records, Counts
end

local function FindTaskRecord(TaskRecords, TaskId)
    TaskId = SafeNumber(TaskId)
    for _, Record in ipairs(TaskRecords) do
        if Record.TaskId == TaskId then
            return Record
        end
    end
end

local function BuildFocusRecord(TaskManager, TaskRecords, Navigation, Dialogue, PreferredTaskId)
    local Focused
    local Source = ""

    local function TrySelect(TaskId, CandidateSource)
        local Record = FindTaskRecord(TaskRecords, TaskId)
        if Record and Record.Status == TaskStatus.PROCESSING then
            Focused = Record
            Source = CandidateSource
            return true
        end
        return false
    end

    if (Navigation.GuideActive or Navigation.AutoMoving)
        and TrySelect(Navigation.TaskId, "navigation") then
    elseif Dialogue.Active and TrySelect(Dialogue.TaskId, "dialogue") then
    elseif TrySelect(PreferredTaskId, "handled") then
    else
        local Success, ShownTasks = pcall(TaskManager.GetTaskList)
        if Success then
            for _, TaskInfo in ipairs(ShownTasks or {}) do
                if TrySelect(TaskInfo.TaskID, "hud") then
                    break
                end
            end
        end
        if not Focused then
            for _, Record in ipairs(TaskRecords) do
                if Record.Status == TaskStatus.PROCESSING and Record.Active and Record.Traced then
                    Focused = Record
                    Source = "traced"
                    break
                end
            end
        end
    end

    if not Focused then
        return {
            TaskId = 0,
            TaskLineId = 0,
            CompletedNodes = 0,
            RemainingNodes = 0,
            TotalNodes = 0,
            HasBranches = false,
            ProgressKnown = false,
            Source = "",
        }
    end

    local RemainingNodes = 0
    local RemainingHasBranches = false
    local Visited = {[Focused.TaskId] = true}
    local Queue = {Focused.TaskId}
    local Head = 1

    local function Enqueue(TaskId)
        TaskId = SafeNumber(TaskId)
        if TaskId <= 0 or Visited[TaskId]
            or GetTaskLineId(TaskManager, TaskId) ~= Focused.TaskLineId then
            return
        end
        Visited[TaskId] = true
        table.insert(Queue, TaskId)
        if IsCountedTask(TaskId) then
            RemainingNodes = RemainingNodes + 1
        end
    end

    while Head <= #Queue and Head <= MaxProgressNodes do
        local TaskId = Queue[Head]
        Head = Head + 1
        local Row = TaskCfg[TaskId]
        if Row then
            local NextTaskIds, SubTaskIds, HasBranches = ResolveLinks(TaskManager, TaskId, Row)
            RemainingHasBranches = RemainingHasBranches or HasBranches
            for _, TaskIdToAdd in ipairs(NextTaskIds) do
                Enqueue(TaskIdToAdd)
            end
            for _, TaskIdToAdd in ipairs(SubTaskIds) do
                Enqueue(TaskIdToAdd)
            end
        end
    end

    local CompletedNodes = 0
    local ProgressKnown = false
    local PathHasBranches = false
    local StartSuccess, FirstTaskId = pcall(
        TaskManager.GetFirstTaskIDOfTaskLine, Focused.TaskLineId)
    FirstTaskId = StartSuccess and SafeNumber(FirstTaskId) or 0
    if FirstTaskId > 0 and TaskCfg[FirstTaskId] then
        local PathQueue = {{
            TaskId = FirstTaskId,
            CompletedNodes = 0,
            HasBranches = false,
        }}
        local PathHead = 1
        local PathVisited = {}
        local Processed = 0
        while PathHead <= #PathQueue and Processed < MaxProgressNodes do
            local Candidate = PathQueue[PathHead]
            PathHead = PathHead + 1
            if not PathVisited[Candidate.TaskId] then
                PathVisited[Candidate.TaskId] = true
                Processed = Processed + 1
                if Candidate.TaskId == Focused.TaskId then
                    CompletedNodes = Candidate.CompletedNodes
                    PathHasBranches = Candidate.HasBranches
                    ProgressKnown = true
                    break
                end

                local Row = TaskCfg[Candidate.TaskId]
                if Row then
                    local NextTaskIds, SubTaskIds, HasBranches =
                        ResolveLinks(TaskManager, Candidate.TaskId, Row)
                    local CompletedBeforeNext = Candidate.CompletedNodes +
                        (IsCountedTask(Candidate.TaskId) and 1 or 0)
                    local function EnqueuePath(TaskId)
                        TaskId = SafeNumber(TaskId)
                        if TaskId > 0
                            and not PathVisited[TaskId]
                            and GetTaskLineId(TaskManager, TaskId) == Focused.TaskLineId then
                            table.insert(PathQueue, {
                                TaskId = TaskId,
                                CompletedNodes = CompletedBeforeNext,
                                HasBranches = Candidate.HasBranches or HasBranches,
                            })
                        end
                    end
                    for _, TaskIdToAdd in ipairs(NextTaskIds) do
                        EnqueuePath(TaskIdToAdd)
                    end
                    for _, TaskIdToAdd in ipairs(SubTaskIds) do
                        EnqueuePath(TaskIdToAdd)
                    end
                end
            end
        end
    end

    return {
        TaskId = Focused.TaskId,
        TaskLineId = Focused.TaskLineId,
        CompletedNodes = CompletedNodes,
        RemainingNodes = RemainingNodes,
        TotalNodes = ProgressKnown and (CompletedNodes + RemainingNodes + 1) or 0,
        HasBranches = RemainingHasBranches or PathHasBranches,
        ProgressKnown = ProgressKnown,
        Source = Source,
    }
end

-- Builds one structural progress record per unique held task id. Tasks on the
-- same task line share a single walk from the line root for completed counts;
-- each task then gets its own forward walk for remaining nodes.
local function BuildProgressRecords(TaskManager, TaskRecords)
    local Result = {}
    local SeenTask = {}
    local OrderedLineIds = {}
    local TasksByLine = {}

    for _, Record in ipairs(TaskRecords) do
        local TaskId = SafeNumber(Record.TaskId)
        if not SeenTask[TaskId] then
            SeenTask[TaskId] = true
            local LineId = SafeNumber(Record.TaskLineId)
            if LineId > 0 then
                if not TasksByLine[LineId] then
                    TasksByLine[LineId] = {}
                    table.insert(OrderedLineIds, LineId)
                end
                table.insert(TasksByLine[LineId], Record)
            else
                table.insert(Result, {
                    TaskId = TaskId,
                    TaskLineId = 0,
                    CompletedNodes = 0,
                    RemainingNodes = 0,
                    TotalNodes = 0,
                    HasBranches = false,
                    ProgressKnown = false,
                })
            end
        end
    end

    for _, LineId in ipairs(OrderedLineIds) do
        local LineRecords = TasksByLine[LineId]
        local StartSuccess, FirstTaskId = pcall(
            TaskManager.GetFirstTaskIDOfTaskLine, LineId)
        FirstTaskId = StartSuccess and SafeNumber(FirstTaskId) or 0

        local CompletedAt = {}
        local BranchesAt = {}
        if FirstTaskId > 0 and TaskCfg[FirstTaskId] then
            local PathQueue = {{
                TaskId = FirstTaskId,
                CompletedNodes = 0,
                HasBranches = false,
            }}
            local PathHead = 1
            local PathVisited = {}
            local Processed = 0
            while PathHead <= #PathQueue and Processed < MaxProgressNodes do
                local Candidate = PathQueue[PathHead]
                PathHead = PathHead + 1
                if not PathVisited[Candidate.TaskId] then
                    PathVisited[Candidate.TaskId] = true
                    Processed = Processed + 1
                    CompletedAt[Candidate.TaskId] = Candidate.CompletedNodes
                    BranchesAt[Candidate.TaskId] = Candidate.HasBranches

                    local Row = TaskCfg[Candidate.TaskId]
                    if Row then
                        local NextTaskIds, SubTaskIds, HasBranches =
                            ResolveLinks(TaskManager, Candidate.TaskId, Row)
                        local CompletedBeforeNext = Candidate.CompletedNodes +
                            (IsCountedTask(Candidate.TaskId) and 1 or 0)
                        local function EnqueuePath(TaskId)
                            TaskId = SafeNumber(TaskId)
                            if TaskId > 0 and not PathVisited[TaskId]
                                and GetTaskLineId(TaskManager, TaskId) == LineId then
                                table.insert(PathQueue, {
                                    TaskId = TaskId,
                                    CompletedNodes = CompletedBeforeNext,
                                    HasBranches = Candidate.HasBranches or HasBranches,
                                })
                            end
                        end
                        for _, TaskIdToAdd in ipairs(NextTaskIds) do
                            EnqueuePath(TaskIdToAdd)
                        end
                        for _, TaskIdToAdd in ipairs(SubTaskIds) do
                            EnqueuePath(TaskIdToAdd)
                        end
                    end
                end
            end
        end

        for _, Focused in ipairs(LineRecords) do
            local CompletedNodes = SafeNumber(CompletedAt[Focused.TaskId])
            local ProgressKnown = CompletedAt[Focused.TaskId] ~= nil
            local RemainingNodes = 0
            local RemainingHasBranches = false

            local Visited = {[Focused.TaskId] = true}
            local Queue = {Focused.TaskId}
            local Head = 1
            local function Enqueue(TaskId)
                TaskId = SafeNumber(TaskId)
                if TaskId <= 0 or Visited[TaskId]
                    or GetTaskLineId(TaskManager, TaskId) ~= LineId then
                    return
                end
                Visited[TaskId] = true
                table.insert(Queue, TaskId)
                if IsCountedTask(TaskId) then
                    RemainingNodes = RemainingNodes + 1
                end
            end

            while Head <= #Queue and Head <= MaxProgressNodes do
                local TaskId = Queue[Head]
                Head = Head + 1
                local Row = TaskCfg[TaskId]
                if Row then
                    local NextTaskIds, SubTaskIds, HasBranches =
                        ResolveLinks(TaskManager, TaskId, Row)
                    RemainingHasBranches = RemainingHasBranches or HasBranches
                    for _, TaskIdToAdd in ipairs(NextTaskIds) do
                        Enqueue(TaskIdToAdd)
                    end
                    for _, TaskIdToAdd in ipairs(SubTaskIds) do
                        Enqueue(TaskIdToAdd)
                    end
                end
            end

            table.insert(Result, {
                TaskId = Focused.TaskId,
                TaskLineId = LineId,
                CompletedNodes = CompletedNodes,
                RemainingNodes = RemainingNodes,
                TotalNodes = ProgressKnown and (CompletedNodes + RemainingNodes + 1) or 0,
                HasBranches = RemainingHasBranches
                    or BranchesAt[Focused.TaskId] == true,
                ProgressKnown = ProgressKnown,
            })
        end
    end

    table.sort(Result, function(A, B)
        if A.TaskId ~= B.TaskId then
            return A.TaskId < B.TaskId
        end
        return A.TaskLineId < B.TaskLineId
    end)
    return Result
end

-- Expands every held task line from its configured root. Exact held/cached
-- statuses are preferred; otherwise completed predecessors are inferred locally
-- from the configured path to each held task.
local function BuildTaskNodeRecords(TaskManager, TaskRecords)
    local Result = {}
    local Truncated = false
    local HeldStatusByTaskId = {}
    local LineIds = {}
    local SeenLine = {}

    for _, Record in ipairs(TaskRecords) do
        if HeldStatusByTaskId[Record.TaskId] == nil
            or Record.Status == TaskStatus.PROCESSING then
            HeldStatusByTaskId[Record.TaskId] = Record.Status
        end
        if Record.TaskLineId > 0 and not SeenLine[Record.TaskLineId] then
            SeenLine[Record.TaskLineId] = true
            table.insert(LineIds, Record.TaskLineId)
        end
    end
    table.sort(LineIds)

    local function ResolveStatus(TaskId)
        local HeldStatus = HeldStatusByTaskId[TaskId]
        if HeldStatus ~= nil then
            return HeldStatus, true
        end
        if TaskManager.GetTaskStatusById then
            local Success, Status = pcall(TaskManager.GetTaskStatusById, TaskId)
            if Success and Status ~= nil then
                return SafeNumber(Status), false, false
            end
        end
        return TaskStatus.NONE_, false, false
    end

    for _, LineId in ipairs(LineIds) do
        if #Result >= MaxTaskNodes then
            Truncated = true
            break
        end

        local StartSuccess, FirstTaskId = pcall(
            TaskManager.GetFirstTaskIDOfTaskLine, LineId)
        FirstTaskId = StartSuccess and SafeNumber(FirstTaskId) or 0
        local Queue = FirstTaskId > 0 and {{
            TaskId = FirstTaskId,
            ParentTaskId = 0,
            Depth = 0,
            SelectedPath = true,
            Branch = false,
            SubTaskEdge = false,
        }} or {}
        local Head = 1
        local Visited = {}
        local NodeByTaskId = {}

        local function Enqueue(
            TaskId, ParentTaskId, Depth, SelectedPath, Branch, SubTaskEdge)
            TaskId = SafeNumber(TaskId)
            if TaskId <= 0 or Visited[TaskId]
                or GetTaskLineId(TaskManager, TaskId) ~= LineId then
                return
            end
            table.insert(Queue, {
                TaskId = TaskId,
                ParentTaskId = ParentTaskId,
                Depth = Depth,
                SelectedPath = SelectedPath,
                Branch = Branch,
                SubTaskEdge = SubTaskEdge,
            })
        end

        while Head <= #Queue do
            if #Result >= MaxTaskNodes then
                Truncated = true
                break
            end

            local Candidate = Queue[Head]
            Head = Head + 1
            if not Visited[Candidate.TaskId] then
                Visited[Candidate.TaskId] = true
                local Row = TaskCfg[Candidate.TaskId]
                if Row then
                    local Status, Held = ResolveStatus(Candidate.TaskId)
                    local Record = {
                        TaskLineId = LineId,
                        TaskId = Candidate.TaskId,
                        ParentTaskId = Candidate.ParentTaskId,
                        Depth = Candidate.Depth,
                        Order = #Result + 1,
                        Status = Status,
                        Held = Held,
                        SelectedPath = Candidate.SelectedPath,
                        Branch = Candidate.Branch,
                        StatusInferred = false,
                        SubTaskEdge = Candidate.SubTaskEdge,
                        Name = tostring(Row.Name or ""),
                        Description = tostring(Row.Description or ""),
                    }
                    table.insert(Result, Record)
                    NodeByTaskId[Candidate.TaskId] = Record

                    local NextTaskIds, SubTaskIds =
                        TaskManager.SplitSubtask(Row.Subtask)
                    local SelectedIndexes = TaskManager.NextIndexesByTaskID[Candidate.TaskId]
                    local HasSelectedIndexes =
                        SelectedIndexes ~= nil and #SelectedIndexes > 0
                    local SelectedIndexMap = {}
                    for _, Index in ipairs(SelectedIndexes or {}) do
                        SelectedIndexMap[Index] = true
                    end

                    for Index, TaskId in ipairs(NextTaskIds) do
                        local EdgeSelected = not HasSelectedIndexes
                            or SelectedIndexMap[Index] == true
                        Enqueue(TaskId, Candidate.TaskId, Candidate.Depth + 1,
                            Candidate.SelectedPath and EdgeSelected,
                            #NextTaskIds > 1, false)
                    end
                    for _, TaskId in ipairs(SubTaskIds) do
                        Enqueue(TaskId, Candidate.TaskId, Candidate.Depth + 1,
                            Candidate.SelectedPath, #SubTaskIds > 1, true)
                    end
                end
            end
        end

        for _, HeldRecord in ipairs(TaskRecords) do
            if HeldRecord.TaskLineId == LineId then
                local Current = NodeByTaskId[HeldRecord.TaskId]
                local PathVisited = {}
                while Current and Current.ParentTaskId > 0
                    and not PathVisited[Current.TaskId] do
                    PathVisited[Current.TaskId] = true
                    local Parent = NodeByTaskId[Current.ParentTaskId]
                    if not Parent then
                        break
                    end
                    if not Current.SubTaskEdge
                        and not Parent.Held
                        and Parent.Status == TaskStatus.NONE_ then
                        Parent.Status = TaskStatus.FINISHED
                        Parent.StatusInferred = true
                    end
                    Current = Parent
                end
            end
        end
    end

    return Result, Truncated
end

local function BuildNextRecords(TaskManager, TaskRecords)
    local Result = {}

    for _, TaskRecord in ipairs(TaskRecords) do
        local Row = TaskCfg[TaskRecord.TaskId]
        if Row and Row.Subtask then
            local Success, NextTaskIds = pcall(function()
                local Candidates = TaskManager.SplitSubtask(Row.Subtask)
                return Candidates
            end)
            if Success and NextTaskIds then
                local SelectedIndexes = TaskManager.NextIndexesByTaskID[TaskRecord.TaskId] or {}
                local SelectedMap = {}
                for _, Index in ipairs(SelectedIndexes) do
                    SelectedMap[SafeNumber(Index)] = true
                end
                local AllSelected = #SelectedIndexes == 0

                for Index, NextTaskId in ipairs(NextTaskIds) do
                    NextTaskId = SafeNumber(NextTaskId)
                    if NextTaskId > 0 and TaskCfg[NextTaskId] then
                        table.insert(Result, {
                            ParentTaskId = TaskRecord.TaskId,
                            Index = Index,
                            Selected = AllSelected or SelectedMap[Index] == true,
                            TaskId = NextTaskId,
                            Name = ResolveStaticTaskName(NextTaskId),
                        })
                    end
                end
            end
        end
    end

    return Result
end

local function BuildTraceRecords(TaskManager)
    local Result = {}
    for MainType, TaskLineId in pairs(TaskManager.TracedTaskLines or {}) do
        if SafeNumber(TaskLineId) > 0 then
            table.insert(Result, {
                MainType = SafeNumber(MainType),
                TaskLineId = SafeNumber(TaskLineId),
            })
        end
    end
    table.sort(Result, function(A, B)
        return A.MainType < B.MainType
    end)
    return Result
end

local function BuildNavigationRecord()
    local Result = {
        GuideActive = false,
        AutoMoving = AutoMoveManager.AutoMoveInfo ~= nil,
        TaskId = 0,
        MapId = 0,
        TargetType = 0,
        TargetId = 0,
    }

    pcall(function()
        local Path
        if Result.AutoMoving and NavigationGuideManager.NavigationGuideInfo then
            Path = NavigationGuideManager.NavigationGuideInfo.AutoMoveGuidePath
        else
            Path = NavigationGuideManager:GetLastPath()
        end
        local Data = Path and Path:GetEndNavigationGuideData()
        if not Data then
            return
        end

        Result.GuideActive = true
        Result.MapId = SafeNumber(Data.MapId)
        Result.TargetType = SafeNumber(Data.TargetType)
        Result.TargetId = SafeNumber(Data.TargetId)
        if ENavigationGuideSourceType and Data.SourceType == ENavigationGuideSourceType.ETask then
            Result.TaskId = SafeNumber(Data.SourceId)
        end
    end)

    return Result
end

local function BuildDialogueRecord()
    local Result = {
        Active = DialogManager.IsDuringDialog() == true,
        StartId = 0,
        CurrentId = 0,
        TaskId = SafeNumber(DialogManager.TaskID),
        TaskLineId = SafeNumber(DialogManager.TaskLineId),
        ComplexChat = false,
        CameraDialog = false,
    }

    local StartSuccess, StartId = pcall(DialogManager.GetStartDialogID, DialogManager)
    if StartSuccess then
        Result.StartId = SafeNumber(StartId)
    end
    local CurrentSuccess, CurrentId = pcall(DialogManager.GetDialogID, DialogManager)
    if CurrentSuccess then
        Result.CurrentId = SafeNumber(CurrentId)
    end
    Result.ComplexChat = ComplexChatCfg[Result.StartId] ~= nil
    local DialogStart = DialogStartCfg[Result.StartId]
    Result.CameraDialog = DialogStart ~= nil and DialogStart.Virtual == true
    return Result
end

function TaskQADiagnostics:GetKnownTask(TaskId)
    return self.KnownTasks and self.KnownTasks[SafeNumber(TaskId)] or nil
end

function TaskQADiagnostics:PushEvent(Kind, TaskId, TaskLineId, Status, Label)
    local Last = self.Events[#self.Events]
    if Last and Last.Kind == Kind and Last.TaskId == SafeNumber(TaskId)
        and Last.TaskLineId == SafeNumber(TaskLineId) then
        Last.TimeMs = GetNowMs()
        Last.Status = SafeNumber(Status)
        Last.Label = Label or Last.Label
        return
    end

    self.EventSequence = self.EventSequence + 1
    table.insert(self.Events, {
        Sequence = self.EventSequence,
        TimeMs = GetNowMs(),
        Kind = Kind,
        TaskId = SafeNumber(TaskId),
        TaskLineId = SafeNumber(TaskLineId),
        Status = SafeNumber(Status),
        Label = Label or "",
    })
    while #self.Events > MaxEvents do
        table.remove(self.Events, 1)
    end
end

function TaskQADiagnostics:MarkDirty(Reason)
    if Reason then
        self.PendingReasons[Reason] = true
    end
    if self.FlushHandle then
        return
    end
    self.FlushHandle = TimerHandle:DelayCall(self, self.Flush, 0.05)
end

function TaskQADiagnostics:OnTaskEvent(TaskId, Reason)
    local Known = self:GetKnownTask(TaskId)
    if Reason == "accept" then
        if not self.TaskManager.bInitTaskList then
            self:PushEvent("accepted", TaskId, Known and Known.TaskLineId, TaskStatus.PROCESSING, Known and Known.Name)
        end
    elseif Reason == "remove" then
        self:PushEvent("removed", TaskId, Known and Known.TaskLineId, Known and Known.Status, Known and Known.Name)
    elseif Reason == "finish" then
        self:PushEvent("finished", TaskId, Known and Known.TaskLineId, TaskStatus.FINISHED, Known and Known.Name)
    elseif Reason == "active" or Reason == "deactive" then
        self:PushEvent(Reason, TaskId, Known and Known.TaskLineId, Known and Known.Status, Known and Known.Name)
    end
    self:MarkDirty(Reason)
end

function TaskQADiagnostics:OnRefreshTask()
    self:MarkDirty("refresh")
end

function TaskQADiagnostics:OnFocusTask(TaskId)
    self.FocusedTaskId = SafeNumber(TaskId)
    self:PushEvent("focus", self.FocusedTaskId,
        GetTaskLineId(self.TaskManager, self.FocusedTaskId), TaskStatus.PROCESSING, "")
    self:MarkDirty("focus")
end

function TaskQADiagnostics:OnTraceTask(Args)
    Args = Args or {}
    self:PushEvent("trace", 0, Args.TaskLineID, 0, "")
    self:MarkDirty("trace")
end

function TaskQADiagnostics:OnTaskLineFinished(TaskLineId)
    self:PushEvent("line_finished", 0, TaskLineId, TaskStatus.FINISHED, "")
    self:MarkDirty("line_finished")
end

function TaskQADiagnostics:OnTaskListInited()
    self:PushEvent("task_list", 0, 0, 0, "")
    self:MarkDirty("task_list")
end

function TaskQADiagnostics:OnReset()
    self.HasBaseline = false
    self.KnownTasks = {}
    self:PushEvent("reset", 0, 0, 0, "")
    self:MarkDirty("reset")
end

function TaskQADiagnostics:GetNavigationTaskId()
    local Navigation = BuildNavigationRecord()
    return Navigation.TaskId, Navigation
end

function TaskQADiagnostics:OnNavigationEvent(_, Reason)
    local TaskId, Navigation = self:GetNavigationTaskId()
    self:PushEvent(Reason, TaskId, TaskId > 0 and GetTaskLineId(self.TaskManager, TaskId) or 0, 0,
        Navigation.AutoMoving and "auto_move" or "guide")
    self:MarkDirty(Reason)
end

function TaskQADiagnostics:OnDialogueEvent(Args, Reason)
    local TaskId = SafeNumber(DialogManager.TaskID)
    local DialogId = SafeNumber(DialogManager:GetStartDialogID())
    if Reason == "dialog_end" and Args then
        DialogId = SafeNumber(Args.StartDialogID)
    end
    self:PushEvent(Reason, TaskId, TaskId > 0 and GetTaskLineId(self.TaskManager, TaskId) or 0, 0,
        tostring(DialogId))
    self:MarkDirty(Reason)
end

function TaskQADiagnostics:OnTaskStatusReceived()
    self:MarkDirty("task_status")
end

function TaskQADiagnostics:UpdateKnownTasks(TaskRecords)
    local Current = {}
    for _, Record in ipairs(TaskRecords) do
        Current[Record.TaskId] = Record
        local Previous = self.KnownTasks[Record.TaskId]
        if self.HasBaseline and Previous and Previous.Status ~= Record.Status then
            self:PushEvent(StatusNames[Record.Status] or "status", Record.TaskId,
                Record.TaskLineId, Record.Status, Record.Name)
        end
    end
    for _, EventRecord in ipairs(self.Events) do
        local CurrentRecord = Current[EventRecord.TaskId]
        if EventRecord.Label == "" and CurrentRecord then
            EventRecord.Label = CurrentRecord.Name
            EventRecord.TaskLineId = CurrentRecord.TaskLineId
            if EventRecord.Status == 0 then
                EventRecord.Status = CurrentRecord.Status
            end
        end
    end
    self.KnownTasks = Current
    self.HasBaseline = true
end

function TaskQADiagnostics:Flush()
    self.FlushHandle = nil

    local TaskManager = self.TaskManager
    if not TaskManager then
        return
    end

    local TaskRecords, Counts = BuildTaskRecords(TaskManager)
    local NextRecords = BuildNextRecords(TaskManager, TaskRecords)
    local TraceRecords = BuildTraceRecords(TaskManager)
    local Navigation = BuildNavigationRecord()
    local Dialogue = BuildDialogueRecord()
    local Focus = BuildFocusRecord(
        TaskManager, TaskRecords, Navigation, Dialogue, self.FocusedTaskId)
    local ProgressRecords = BuildProgressRecords(TaskManager, TaskRecords)
    local TaskNodeRecords, TaskNodesTruncated =
        BuildTaskNodeRecords(TaskManager, TaskRecords)
    self:UpdateKnownTasks(TaskRecords)

    self.Sequence = self.Sequence + 1
    local Sequence = self.Sequence
    local RecordCount = 0
    local Lines = {}
    local Reasons = {}
    for Reason in pairs(self.PendingReasons) do
        table.insert(Reasons, Reason)
    end
    table.sort(Reasons)
    self.PendingReasons = {}

    local function AddLine(...)
        local Fields = {...}
        for Index, Value in ipairs(Fields) do
            Fields[Index] = EscapeField(Value)
        end
        table.insert(Lines, table.concat(Fields, "\t"))
        RecordCount = RecordCount + 1
    end

    table.insert(Lines, table.concat({
        "SERIA_QA_SNAPSHOT",
        tostring(SchemaVersion),
        tostring(Sequence),
        tostring(GetNowMs()),
        EscapeField(table.concat(Reasons, ",")),
    }, "\t"))

    AddLine("META", BoolText(TaskManager.bReceiveTaskList), Counts.Server, Counts.Client,
        BoolText(TaskNodesTruncated))

    for _, Record in ipairs(TaskRecords) do
        AddLine("TASK", Record.TaskId, Record.TaskLineId, Record.Status, Record.TaskClass,
            Record.MType, Record.Value, BoolText(Record.Active), BoolText(Record.Traced),
            BoolText(Record.Shown), BoolText(Record.Client), BoolText(Record.SubTask),
            BoolText(Record.Parallel), BoolText(Record.AutoNext), Record.Name, Record.Description)
    end

    for _, Record in ipairs(NextRecords) do
        AddLine("NEXT", Record.ParentTaskId, Record.Index, BoolText(Record.Selected),
            Record.TaskId, Record.Name)
    end

    for _, Record in ipairs(TraceRecords) do
        AddLine("TRACE", Record.MainType, Record.TaskLineId)
    end

    AddLine("NAV", BoolText(Navigation.GuideActive), BoolText(Navigation.AutoMoving),
        Navigation.TaskId, Navigation.MapId, Navigation.TargetType, Navigation.TargetId)
    AddLine("DIALOG", BoolText(Dialogue.Active), Dialogue.StartId, Dialogue.CurrentId,
        Dialogue.TaskId, Dialogue.TaskLineId, BoolText(Dialogue.ComplexChat),
        BoolText(Dialogue.CameraDialog))
    AddLine("FOCUS", Focus.TaskId, Focus.TaskLineId, Focus.CompletedNodes,
        Focus.RemainingNodes, Focus.TotalNodes, BoolText(Focus.HasBranches),
        BoolText(Focus.ProgressKnown), Focus.Source)

    for _, Record in ipairs(ProgressRecords) do
        AddLine("PROGRESS", Record.TaskId, Record.TaskLineId, Record.CompletedNodes,
            Record.RemainingNodes, Record.TotalNodes, BoolText(Record.HasBranches),
            BoolText(Record.ProgressKnown))
    end

    for _, Record in ipairs(TaskNodeRecords) do
        AddLine("NODE", Record.TaskLineId, Record.TaskId, Record.ParentTaskId,
            Record.Depth, Record.Order, Record.Status, BoolText(Record.Held),
            BoolText(Record.SelectedPath), BoolText(Record.Branch),
            BoolText(Record.StatusInferred), BoolText(Record.SubTaskEdge),
            Record.Name, Record.Description)
    end

    for _, Record in ipairs(self.Events) do
        AddLine("EVENT", Record.Sequence, Record.TimeMs, Record.Kind, Record.TaskId,
            Record.TaskLineId, Record.Status, Record.Label)
    end

    table.insert(Lines, table.concat({"END", tostring(Sequence), tostring(RecordCount)}, "\t"))
    local Content = table.concat(Lines, "\n") .. "\n"
    local Slot = Sequence % 2
    local FilePath = UE4.UKismetSystemLibrary.GetProjectSavedDirectory() .. SnapshotPrefix .. tostring(Slot)
    local Success = UE4.USeriaLuaInterface.SaveStringToFile(Content, FilePath, true)

    if not Success then
        if self.LastWriteError ~= FilePath then
            Error("[TaskQADiagnostics] Failed to write snapshot: ", FilePath)
            self.LastWriteError = FilePath
        end
    else
        self.LastWriteError = nil
    end
end

function TaskQADiagnostics.Init(TaskManager)
    if TaskQADiagnostics.Initialized then
        return
    end

    TaskQADiagnostics.Initialized = true
    TaskQADiagnostics.TaskManager = TaskManager
    TaskQADiagnostics.Sequence = 0
    TaskQADiagnostics.EventSequence = 0
    TaskQADiagnostics.Events = {}
    TaskQADiagnostics.KnownTasks = {}
    TaskQADiagnostics.PendingReasons = {}
    TaskQADiagnostics.HasBaseline = false
    TaskQADiagnostics.FocusedTaskId = 0

    TaskManager.OnAcceptTaskEvent:Add(TaskQADiagnostics.OnTaskEvent, TaskQADiagnostics, "accept")
    TaskManager.RemoveTaskEvent:Add(TaskQADiagnostics.OnTaskEvent, TaskQADiagnostics, "remove")
    TaskManager.FinishTaskEvent:Add(TaskQADiagnostics.OnTaskEvent, TaskQADiagnostics, "finish")
    TaskManager.ActiveTaskEvent:Add(TaskQADiagnostics.OnTaskEvent, TaskQADiagnostics, "active")
    TaskManager.DeactiveTaskEvent:Add(TaskQADiagnostics.OnTaskEvent, TaskQADiagnostics, "deactive")
    TaskManager.OnRefreshTaskEvent:Add(TaskQADiagnostics.OnRefreshTask, TaskQADiagnostics)
    TaskManager.OnHandleTaskEvent:Add(TaskQADiagnostics.OnFocusTask, TaskQADiagnostics)
    TaskManager.OnTraceTaskEvent:Add(TaskQADiagnostics.OnTraceTask, TaskQADiagnostics)
    TaskManager.OnTaskLineFinishedEvent:Add(TaskQADiagnostics.OnTaskLineFinished, TaskQADiagnostics)
    TaskManager.OnTaskListInitedEvent:Add(TaskQADiagnostics.OnTaskListInited, TaskQADiagnostics)
    TaskManager.TaskLineStateChangeEvent:Add(TaskQADiagnostics.OnRefreshTask, TaskQADiagnostics)
    if TaskManager.TaskStatusReceivedEvent then
        TaskManager.TaskStatusReceivedEvent:Add(
            TaskQADiagnostics.OnTaskStatusReceived, TaskQADiagnostics)
    end
    TaskManager.AllNPCRemoveTaskEvent:Add(TaskQADiagnostics.OnReset, TaskQADiagnostics)

    NavigationGuideManager.PostAddPathEvent:Add(TaskQADiagnostics.OnNavigationEvent, TaskQADiagnostics, "guide_add")
    NavigationGuideManager.PostRemovePathEvent:Add(TaskQADiagnostics.OnNavigationEvent, TaskQADiagnostics, "guide_remove")
    NavigationGuideManager.PostRefreshMovePathEvent:Add(TaskQADiagnostics.OnNavigationEvent, TaskQADiagnostics, "guide_refresh")
    AutoMoveManager.AutoMoveStartEvent:Add(TaskQADiagnostics.OnNavigationEvent, TaskQADiagnostics, "nav_start")
    AutoMoveManager.AutoMoveEndEvent:Add(TaskQADiagnostics.OnNavigationEvent, TaskQADiagnostics, "nav_end")

    DialogManager.HandleDialogEvent:Add(TaskQADiagnostics.OnDialogueEvent, TaskQADiagnostics, "dialog_start")
    DialogManager.ProcessDialogEvent:Add(TaskQADiagnostics.OnDialogueEvent, TaskQADiagnostics, "dialog_step")
    DialogManager.EndDialogEvent:Add(TaskQADiagnostics.OnDialogueEvent, TaskQADiagnostics, "dialog_end")

    TaskQADiagnostics:MarkDirty("init")
end

return TaskQADiagnostics
