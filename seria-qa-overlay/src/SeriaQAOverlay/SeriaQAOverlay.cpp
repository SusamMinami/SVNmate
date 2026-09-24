#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define ImTextureID ImU64

#include <windows.h>

#include <imgui.h>
#include <reshade.hpp>

#include "Snapshot.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

extern "C" __declspec(dllexport) const char *NAME = "Seria QA Overlay";
extern "C" __declspec(dllexport) const char *DESCRIPTION =
	"Read-only task flow plus allowlisted QA actions and optional DLSS5 diagnostics for Seria.";

namespace
{
	using seria_qa::snapshot;

	constexpr char addon_version[] = "0.12.0";
	constexpr ULONGLONG snapshot_poll_interval_ms = 100;
	constexpr ULONGLONG diagnostics_poll_interval_ms = 1000;
	constexpr ULONGLONG task_change_highlight_ms = 12'000;
	constexpr size_t max_file_bytes = 512 * 1024;
	constexpr char capture_gm_dialog_command[] =
		"RunLuaString dofile(UE4.USeriaLuaInterface.GetProjectBinariesDirectory()..\"/SeriaQA.lua\")";
	constexpr char capture_external_gm_command[] =
		"gm:RunLuaString dofile(UE4.USeriaLuaInterface.GetProjectBinariesDirectory()..\"/SeriaQA.lua\")";

	enum class gm_command_id
	{
		print_current_task,
		task_list_print,
		debug_task_info,
		show_mission_dialog_info,
		get_rotation,
		get_tod,
		scene_online_num,
		show_location,
		add_task,
		skip_level_sequence,
		add_buff,
		kill_hostile_monsters,
	};

	enum class gm_command_category
	{
		task,
		location,
		action,
	};

	enum class gm_parameter_kind
	{
		none,
		task_id,
		node_task_id,
		buff,
	};

	struct gm_command_definition
	{
		gm_command_id id;
		gm_command_category category;
		const char *command;
		const char *action;
		const char *description;
		const char *source;
		gm_parameter_kind parameters;
		bool destructive;
	};

	constexpr std::array<gm_command_definition, 12> gm_command_definitions = {{
		{ gm_command_id::print_current_task, gm_command_category::task,
			"PrintCurrentTask", "打印当前任务",
			"输出当前任务及可见、隐藏任务关系。", "客户端 · 日志",
			gm_parameter_kind::none, false },
		{ gm_command_id::task_list_print, gm_command_category::task,
			"TaskListPrint", "打印任务列表",
			"输出当前持有任务列表。", "客户端 · 日志",
			gm_parameter_kind::none, false },
		{ gm_command_id::debug_task_info, gm_command_category::task,
			"DebugTaskInfo", "切换任务调试显示",
			"开启或关闭屏幕上的追踪任务调试信息。", "客户端 · 显示开关",
			gm_parameter_kind::none, false },
		{ gm_command_id::show_mission_dialog_info, gm_command_category::task,
			"ShowMissionDialogInfo", "评估任务线对白",
			"从指定起始任务递归统计任务线对白长度。", "客户端 · 日志",
			gm_parameter_kind::task_id, false },
		{ gm_command_id::get_rotation, gm_command_category::location,
			"GetRotation", "查看角色朝向",
			"显示主角当前 Pitch、Yaw、Roll。", "客户端 · 屏幕与聊天",
			gm_parameter_kind::none, false },
		{ gm_command_id::get_tod, gm_command_category::location,
			"GetTOD", "查看场景时间",
			"显示当前场景 TOD 时间值。", "客户端 · 屏幕与日志",
			gm_parameter_kind::none, false },
		{ gm_command_id::scene_online_num, gm_command_category::location,
			"sceneOnlineNum", "查询场景在线数",
			"查询场景服帧率和在线人数；权限或环境不支持时由游戏拒绝。",
			"场景服 · 返回消息", gm_parameter_kind::none, false },
		{ gm_command_id::show_location, gm_command_category::location,
			"showLocation", "打开位置面板",
			"打开角色、怪物和 NPC 的位置诊断面板。", "客户端 · 本地面板",
			gm_parameter_kind::none, false },
		{ gm_command_id::add_task, gm_command_category::action,
			"addtask", "添加任务",
			"将指定任务节点添加到当前角色；重复或条件不满足时由服务器拒绝。",
			"服务器 · 修改任务状态", gm_parameter_kind::node_task_id, false },
		{ gm_command_id::skip_level_sequence, gm_command_category::action,
			"SkipLevelSequence", "跳过当前动画",
			"立即跳过当前正在播放的整段剧情动画。",
			"客户端 · 改变播放状态", gm_parameter_kind::none, false },
		{ gm_command_id::add_buff, gm_command_category::action,
			"AddBuff", "为自己添加 Buff",
			"按 Buff ID 和层数为当前角色添加 Buff；需要 GM 1 级权限。",
			"场景服 · 修改角色状态", gm_parameter_kind::buff, false },
		{ gm_command_id::kill_hostile_monsters, gm_command_category::action,
			"kill", "击杀当前房间敌人",
			"击杀当前房间内与玩家阵营敌对的所有怪物。",
			"场景服 · 高风险", gm_parameter_kind::none, true },
	}};

	const ImVec4 color_bg = ImVec4(0.12f, 0.12f, 0.13f, 0.96f);
	const ImVec4 color_panel = ImVec4(0.15f, 0.15f, 0.16f, 0.98f);
	const ImVec4 color_text = ImVec4(0.94f, 0.94f, 0.95f, 1.0f);
	const ImVec4 color_muted = ImVec4(0.72f, 0.73f, 0.75f, 1.0f);
	const ImVec4 color_cyan = ImVec4(0.64f, 0.76f, 0.90f, 1.0f);
	const ImVec4 color_yellow = ImVec4(0.87f, 0.75f, 0.53f, 1.0f);
	const ImVec4 color_red = ImVec4(0.95f, 0.62f, 0.60f, 1.0f);

	HMODULE g_module = nullptr;
	bool g_registered = false;
	bool g_ui_registered = false;
	bool g_initialized = false;
	bool g_hud_visible = true;
	bool g_overlay_open = false;
	bool g_task_workspace_open = false;
	bool g_task_workspace_focus_requested = false;
	bool g_workspace_cursor_owned = false;
	bool g_home_opens_full_reshade = false;
	bool g_task_interaction_hint_pending = true;
	int64_t g_task_interaction_hint_id = 0;
	bool g_toggle_chord_down = false;
	int g_hud_opacity_percent = 78;
	int64_t g_selected_task_id = 0;
	bool g_selected_task_client = false;
	int64_t g_selected_task_node_id = 0;
	int64_t g_selected_task_node_line_id = 0;
	int g_task_filter = 0;
	char g_task_search[192] = {};
	bool g_scroll_to_selected = false;
	ULONGLONG g_copied_until = 0;
	int64_t g_mission_dialog_task_id = 0;
	int64_t g_buff_id = 0;
	int g_buff_stacks = 1;
	std::filesystem::path g_module_dir;
	FILETIME g_process_start_time = {};

	struct recent_task_change
	{
		int64_t task_id = 0;
		uint64_t event_sequence = 0;
		int64_t event_time_ms = 0;
		ULONGLONG expires_at = 0;
		std::string kind;
		std::string label;
	};

	std::vector<recent_task_change> g_recent_task_changes;
	bool g_activity_initialized = false;
	uint64_t g_activity_snapshot_sequence = 0;
	uint64_t g_last_event_sequence = 0;
	int64_t g_last_event_time_ms = 0;

	enum class gm_submission_phase
	{
		idle,
		open_gm,
		select_all,
		paste,
		submit,
		waiting_capture,
		failed,
	};

	gm_submission_phase g_gm_submission = gm_submission_phase::idle;
	ULONGLONG g_gm_submission_due = 0;
	std::string g_pending_gm_command;
	std::string g_pending_gm_label;
	bool g_pending_gm_is_capture = false;
	std::string g_gm_submission_error;
	bool g_has_last_gm_submission = false;
	bool g_last_gm_submission_succeeded = false;
	std::string g_last_gm_command;
	std::string g_last_gm_label;
	std::string g_last_gm_message;

	bool foreground_window_belongs_to_process()
	{
		DWORD process_id = 0;
		GetWindowThreadProcessId(GetForegroundWindow(), &process_id);
		return process_id == GetCurrentProcessId();
	}

	bool send_key(WORD key)
	{
		std::array<INPUT, 2> inputs = {};
		inputs[0].type = INPUT_KEYBOARD;
		inputs[0].ki.wVk = key;
		inputs[1].type = INPUT_KEYBOARD;
		inputs[1].ki.wVk = key;
		inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
		return SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT)) ==
			static_cast<UINT>(inputs.size());
	}

	bool select_all_text()
	{
		std::array<INPUT, 4> inputs = {};
		inputs[0].type = INPUT_KEYBOARD;
		inputs[0].ki.wVk = VK_CONTROL;
		inputs[1].type = INPUT_KEYBOARD;
		inputs[1].ki.wVk = 'A';
		inputs[2].type = INPUT_KEYBOARD;
		inputs[2].ki.wVk = 'A';
		inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
		inputs[3].type = INPUT_KEYBOARD;
		inputs[3].ki.wVk = VK_CONTROL;
		inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
		return SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT)) ==
			static_cast<UINT>(inputs.size());
	}

	bool paste_clipboard()
	{
		std::array<INPUT, 4> inputs = {};
		inputs[0].type = INPUT_KEYBOARD;
		inputs[0].ki.wVk = VK_CONTROL;
		inputs[1].type = INPUT_KEYBOARD;
		inputs[1].ki.wVk = 'V';
		inputs[2].type = INPUT_KEYBOARD;
		inputs[2].ki.wVk = 'V';
		inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
		inputs[3].type = INPUT_KEYBOARD;
		inputs[3].ki.wVk = VK_CONTROL;
		inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
		return SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT)) ==
			static_cast<UINT>(inputs.size());
	}

	bool gm_submission_running()
	{
		return g_gm_submission != gm_submission_phase::idle &&
			g_gm_submission != gm_submission_phase::failed;
	}

	void remember_gm_submission_result(bool succeeded, const char *message)
	{
		g_has_last_gm_submission = true;
		g_last_gm_submission_succeeded = succeeded;
		g_last_gm_command = g_pending_gm_command;
		g_last_gm_label = g_pending_gm_label;
		g_last_gm_message = message;
	}

	void fail_gm_submission(const char *message)
	{
		g_gm_submission = gm_submission_phase::failed;
		g_gm_submission_error = message;
		remember_gm_submission_result(false, message);
	}

	const gm_command_definition *find_gm_command(gm_command_id id)
	{
		const auto found = std::find_if(
			gm_command_definitions.begin(), gm_command_definitions.end(),
			[id](const gm_command_definition &command) {
				return command.id == id;
			});
		return found == gm_command_definitions.end() ? nullptr : &*found;
	}

	bool is_positive_decimal(
		std::string_view value,
		int64_t maximum = std::numeric_limits<int64_t>::max())
	{
		if (value.empty() || value.front() == '0')
			return false;

		int64_t parsed = 0;
		for (const unsigned char character : value)
		{
			if (character < '0' || character > '9')
				return false;
			const int digit = character - '0';
			if (parsed > (maximum - digit) / 10)
				return false;
			parsed = parsed * 10 + digit;
		}
		return parsed > 0;
	}

	bool is_allowed_gm_submission(
		std::string_view command,
		bool wait_for_capture)
	{
		if (wait_for_capture)
			return command == capture_gm_dialog_command;

		for (const gm_command_definition &definition : gm_command_definitions)
		{
			const std::string_view fixed_command = definition.command;
			if (definition.parameters == gm_parameter_kind::none)
			{
				if (command == fixed_command)
					return true;
				continue;
			}

			if (command.size() <= fixed_command.size() + 1 ||
				command.substr(0, fixed_command.size()) != fixed_command ||
				command[fixed_command.size()] != ' ')
				continue;
			const std::string_view argument =
				command.substr(fixed_command.size() + 1);
			if (definition.parameters == gm_parameter_kind::task_id ||
				definition.parameters == gm_parameter_kind::node_task_id)
				return is_positive_decimal(argument);
			if (definition.parameters == gm_parameter_kind::buff)
			{
				const size_t separator = argument.find(' ');
				if (separator == std::string_view::npos ||
					argument.find(' ', separator + 1) != std::string_view::npos)
					return false;
				return is_positive_decimal(argument.substr(0, separator)) &&
					is_positive_decimal(argument.substr(separator + 1), 999);
			}
		}
		return false;
	}

	void begin_gm_submission(
		reshade::api::effect_runtime *runtime,
		std::string command,
		std::string label,
		bool wait_for_capture)
	{
		if (gm_submission_running())
			return;
		if (!is_allowed_gm_submission(command, wait_for_capture))
		{
			g_pending_gm_command = std::move(command);
			g_pending_gm_label = std::move(label);
			g_pending_gm_is_capture = wait_for_capture;
			fail_gm_submission("命令不在固定白名单中。");
			return;
		}

		g_pending_gm_command = std::move(command);
		g_pending_gm_label = std::move(label);
		g_pending_gm_is_capture = wait_for_capture;
		ImGui::SetClipboardText(g_pending_gm_command.c_str());
		g_gm_submission = gm_submission_phase::open_gm;
		g_gm_submission_due = GetTickCount64() + 250;
		g_gm_submission_error.clear();
		if (g_task_workspace_open)
		{
			g_task_workspace_open = false;
		}
		else if (g_overlay_open &&
			!runtime->open_overlay(false, reshade::api::input_source::none))
			fail_gm_submission("无法关闭 ReShade，请关闭工具页后重试。");
	}

	void begin_capture_activation(reshade::api::effect_runtime *runtime)
	{
		begin_gm_submission(
			runtime,
			capture_gm_dialog_command,
			"启动任务采集",
			true);
	}

	void begin_whitelisted_gm_submission(
		reshade::api::effect_runtime *runtime,
		gm_command_id id,
		int64_t first_argument = 0,
		int64_t second_argument = 0)
	{
		const gm_command_definition *const definition = find_gm_command(id);
		if (definition == nullptr)
		{
			g_pending_gm_command.clear();
			g_pending_gm_label = "GM 白名单命令";
			g_pending_gm_is_capture = false;
			fail_gm_submission("命令不在固定白名单中。");
			return;
		}

		std::string command = definition->command;
		if (definition->parameters == gm_parameter_kind::task_id ||
			definition->parameters == gm_parameter_kind::node_task_id)
		{
			if (first_argument <= 0)
			{
				g_pending_gm_command = command;
				g_pending_gm_label = definition->action;
				g_pending_gm_is_capture = false;
				fail_gm_submission(
					definition->parameters == gm_parameter_kind::node_task_id
						? "请输入有效的任务节点 ID。"
						: "请输入有效的起始任务 ID。");
				return;
			}
			command += " " + std::to_string(first_argument);
		}
		else if (definition->parameters == gm_parameter_kind::buff)
		{
			if (first_argument <= 0 || second_argument < 1 || second_argument > 999)
			{
				g_pending_gm_command = command;
				g_pending_gm_label = definition->action;
				g_pending_gm_is_capture = false;
				fail_gm_submission("请输入有效的 Buff ID；层数范围为 1-999。");
				return;
			}
			command += " " + std::to_string(first_argument);
			command += " " + std::to_string(second_argument);
		}
		begin_gm_submission(runtime, std::move(command), definition->action, false);
	}

	void update_gm_submission(bool capture_live)
	{
		if (g_gm_submission == gm_submission_phase::waiting_capture && capture_live)
		{
			remember_gm_submission_result(
				true, "任务采集已启动，快照正在实时更新。");
			g_gm_submission = gm_submission_phase::idle;
			g_gm_submission_error.clear();
			return;
		}
		if (g_gm_submission == gm_submission_phase::idle ||
			g_gm_submission == gm_submission_phase::failed)
			return;

		const ULONGLONG now = GetTickCount64();
		if (now < g_gm_submission_due)
			return;
		const bool foreground_owned = foreground_window_belongs_to_process();
		if (!foreground_owned)
		{
			fail_gm_submission("游戏窗口不在前台，请切回游戏后重试。");
			return;
		}

		switch (g_gm_submission)
		{
		case gm_submission_phase::open_gm:
		{
			const bool sent = send_key(VK_OEM_5);
			if (!sent)
			{
				fail_gm_submission("无法打开 GM 输入框。");
				return;
			}
			g_gm_submission = gm_submission_phase::select_all;
			g_gm_submission_due = now + 350;
			break;
		}
		case gm_submission_phase::select_all:
		{
			const bool selected = select_all_text();
			if (!selected)
			{
				fail_gm_submission("无法选中 GM 输入框中的旧命令。");
				return;
			}
			g_gm_submission = gm_submission_phase::paste;
			g_gm_submission_due = now + 100;
			break;
		}
		case gm_submission_phase::paste:
		{
			const bool pasted = paste_clipboard();
			if (!pasted)
			{
				fail_gm_submission("无法粘贴 GM 命令。");
				return;
			}
			g_gm_submission = gm_submission_phase::submit;
			g_gm_submission_due = now + 150;
			break;
		}
		case gm_submission_phase::submit:
		{
			const bool submitted = send_key(VK_RETURN);
			if (!submitted)
			{
				fail_gm_submission("无法提交 GM 命令。");
				return;
			}
			if (g_pending_gm_is_capture)
			{
				g_gm_submission = gm_submission_phase::waiting_capture;
				g_gm_submission_due = now + 8000;
			}
			else
			{
				remember_gm_submission_result(
					true, "命令已提交；结果请查看游戏界面、聊天或日志。");
				g_gm_submission = gm_submission_phase::idle;
			}
			break;
		}
		case gm_submission_phase::waiting_capture:
			fail_gm_submission("未收到任务数据。请确认已进入角色，或复制命令手动执行。");
			break;
		default:
			break;
		}
	}

	uint64_t file_time_value(const FILETIME &time)
	{
		ULARGE_INTEGER value = {};
		value.LowPart = time.dwLowDateTime;
		value.HighPart = time.dwHighDateTime;
		return value.QuadPart;
	}

	bool get_file_time(const std::filesystem::path &path, FILETIME &time, uint64_t *size = nullptr)
	{
		WIN32_FILE_ATTRIBUTE_DATA data = {};
		if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data) ||
			(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
			return false;

		time = data.ftLastWriteTime;
		if (size != nullptr)
			*size = (static_cast<uint64_t>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
		return true;
	}

	bool read_file(const std::filesystem::path &path, std::string &content, std::string &error)
	{
		FILETIME ignored = {};
		uint64_t size = 0;
		if (!get_file_time(path, ignored, &size))
		{
			error = "file is missing";
			return false;
		}
		if (size == 0 || size > max_file_bytes)
		{
			error = size == 0 ? "file is empty" : "file exceeds 512 KiB";
			return false;
		}

		std::ifstream stream(path, std::ios::binary);
		if (!stream)
		{
			error = "file could not be opened";
			return false;
		}
		content.resize(static_cast<size_t>(size));
		stream.read(content.data(), static_cast<std::streamsize>(content.size()));
		if (!stream || static_cast<size_t>(stream.gcount()) != content.size())
		{
			error = "file changed during read";
			return false;
		}
		return true;
	}

	std::string read_tail(const std::filesystem::path &path, size_t limit)
	{
		std::ifstream stream(path, std::ios::binary);
		if (!stream)
			return {};
		stream.seekg(0, std::ios::end);
		const std::streamoff size = stream.tellg();
		const std::streamoff start = std::max<std::streamoff>(0, size - static_cast<std::streamoff>(limit));
		stream.seekg(start, std::ios::beg);
		std::string content(static_cast<size_t>(size - start), '\0');
		stream.read(content.data(), static_cast<std::streamsize>(content.size()));
		content.resize(static_cast<size_t>(stream.gcount()));
		return content;
	}

	bool is_current_process_file(const FILETIME &write_time)
	{
		constexpr uint64_t tolerance = 2ULL * 10'000'000ULL;
		return file_time_value(write_time) + tolerance >= file_time_value(g_process_start_time);
	}

	struct slot_cache
	{
		std::filesystem::path path;
		FILETIME write_time = {};
		bool present = false;
		bool seen = false;
		bool fresh = false;
		bool disappeared = false;
		seria_qa::parse_result parsed;
	};

	enum class snapshot_transport
	{
		offline,
		live,
		stale,
	};

	struct snapshot_store
	{
		std::array<slot_cache, 2> slots;
		std::optional<snapshot> current;
		snapshot_transport transport = snapshot_transport::offline;
		std::string error;
		ULONGLONG last_poll = 0;
		ULONGLONG adopted_tick = 0;

		void initialize(const std::filesystem::path &saved_dir)
		{
			slots[0].path = saved_dir / L"SeriaQAOverlay.0";
			slots[1].path = saved_dir / L"SeriaQAOverlay.1";
		}

		void poll()
		{
			const ULONGLONG now = GetTickCount64();
			if (now - last_poll < snapshot_poll_interval_ms)
				return;
			last_poll = now;

			for (slot_cache &slot : slots)
			{
				FILETIME write_time = {};
				uint64_t size = 0;
				if (!get_file_time(slot.path, write_time, &size))
				{
					if (slot.present)
						slot.disappeared = true;
					slot.present = false;
					slot.fresh = false;
					continue;
				}
				const bool changed = !slot.seen || !slot.present ||
					CompareFileTime(&slot.write_time, &write_time) != 0;
				slot.present = true;
				slot.disappeared = false;
				if (!changed)
					continue;

				slot.seen = true;
				slot.write_time = write_time;
				slot.fresh = is_current_process_file(write_time);
				if (!slot.fresh)
					continue;

				std::string content;
				std::string read_error;
				if (!read_file(slot.path, content, read_error))
				{
					slot.parsed = {};
					slot.parsed.error = std::move(read_error);
					continue;
				}
				slot.parsed = seria_qa::parse_snapshot(content);
			}

			const slot_cache *best = nullptr;
			const slot_cache *newest = nullptr;
			bool any_present = false;
			bool any_disappeared = false;
			for (const slot_cache &slot : slots)
			{
				any_present = any_present || slot.present;
				any_disappeared = any_disappeared || slot.disappeared;
				if (!slot.seen || !slot.fresh)
					continue;
				if (newest == nullptr || CompareFileTime(&newest->write_time, &slot.write_time) < 0)
					newest = &slot;
				if (!slot.parsed.valid)
					continue;
				if (best == nullptr ||
					CompareFileTime(&best->write_time, &slot.write_time) < 0 ||
					(CompareFileTime(&best->write_time, &slot.write_time) == 0 &&
					 best->parsed.value.sequence < slot.parsed.value.sequence))
					best = &slot;
			}

			if (best != nullptr &&
				(!current.has_value() || current->sequence != best->parsed.value.sequence))
			{
				current = best->parsed.value;
				adopted_tick = now;
			}

			if (newest != nullptr && !newest->parsed.valid)
			{
				error = newest->parsed.error;
				transport = current.has_value() ? snapshot_transport::stale : snapshot_transport::offline;
			}
			else if (any_disappeared)
			{
				error = "a previously observed snapshot slot is missing";
				transport = current.has_value() ? snapshot_transport::stale : snapshot_transport::offline;
			}
			else if (best == nullptr)
			{
				error = any_present ? "snapshot files belong to an earlier process" : "snapshot files are missing";
				transport = current.has_value() ? snapshot_transport::stale : snapshot_transport::offline;
			}
			else
			{
				error.clear();
				transport = snapshot_transport::live;
			}
		}

		bool is_live() const
		{
			return transport == snapshot_transport::live;
		}
	};

	snapshot_store g_snapshots;

	enum class health_level
	{
		active,
		ready,
		check,
	};

	struct health_issue
	{
		std::string problem;
		std::string action;
	};

	struct dlss_diagnostics
	{
		health_level health = health_level::check;
		bool available = false;
		std::string runtime_api = "unknown";
		std::string bridge_evidence = "No current-session bridge evidence.";
		std::string renodx_evidence = "No current-session RenoDX evidence.";
		std::string neural_uplift = "missing";
		std::string nr_preset = "missing";
		std::string nr_style = "missing";
		int stage = std::numeric_limits<int>::min();
		int mode = std::numeric_limits<int>::min();
		int skip_exe = std::numeric_limits<int>::min();
		int resolution_x = 0;
		int resolution_y = 0;
		bool bridge_installed = false;
		bool bridge_loaded = false;
		bool renodx_installed = false;
		bool renodx_loaded = false;
		bool dlss_installed = false;
		bool dlssnr_installed = false;
		bool delivery_proven = false;
		std::vector<health_issue> issues;
		ULONGLONG last_poll = 0;
	};

	dlss_diagnostics g_dlss;

	std::optional<std::string> read_ini_value(
		const std::filesystem::path &path, const wchar_t *section, const wchar_t *key)
	{
		wchar_t value[256] = {};
		constexpr wchar_t missing[] = L"{MISSING}";
		GetPrivateProfileStringW(section, key, missing, value, static_cast<DWORD>(std::size(value)), path.c_str());
		if (wcscmp(value, missing) == 0)
			return std::nullopt;

		const int needed = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
		if (needed <= 1)
			return std::string();
		std::string result(static_cast<size_t>(needed), '\0');
		WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), needed, nullptr, nullptr);
		result.pop_back();
		return result;
	}

	int parse_config_int(const std::filesystem::path &path, std::string_view key)
	{
		std::ifstream stream(path);
		std::string line;
		while (std::getline(stream, line))
		{
			if (!line.empty() && line.back() == '\r')
				line.pop_back();
			const size_t equal = line.find('=');
			if (equal == std::string::npos || std::string_view(line.data(), equal) != key)
				continue;
			int value = 0;
			const char *const begin = line.data() + equal + 1;
			const char *const end = line.data() + line.size();
			const auto result = std::from_chars(begin, end, value);
			return result.ec == std::errc() && result.ptr == end
				? value
				: std::numeric_limits<int>::min();
		}
		return std::numeric_limits<int>::min();
	}

	struct log_match
	{
		size_t position = std::string_view::npos;
		std::string line;

		explicit operator bool() const
		{
			return position != std::string_view::npos;
		}
	};

	log_match last_matching_line(
		std::string_view text,
		const std::vector<std::string_view> &needles,
		std::string_view required_scope = {})
	{
		log_match result;
		size_t start = 0;
		while (start < text.size())
		{
			size_t end = text.find('\n', start);
			if (end == std::string_view::npos)
				end = text.size();
			std::string_view line = text.substr(start, end - start);
			if (!line.empty() && line.back() == '\r')
				line.remove_suffix(1);
			if (!required_scope.empty() && line.find(required_scope) == std::string_view::npos)
			{
				start = end + 1;
				continue;
			}
			for (const std::string_view needle : needles)
			{
				if (line.find(needle) != std::string_view::npos)
				{
					result.position = start;
					result.line.assign(line);
					break;
				}
			}
			start = end + 1;
		}
		return result;
	}

	std::string trim_evidence(std::string value)
	{
		const size_t prefix = value.find_first_not_of(" \t");
		if (prefix != std::string::npos)
			value.erase(0, prefix);
		if (value.size() > 190)
			value = value.substr(0, 187) + "...";
		return value;
	}

	const char *api_name(reshade::api::device_api api)
	{
		switch (api)
		{
		case reshade::api::device_api::d3d9:
			return "D3D9";
		case reshade::api::device_api::d3d10:
			return "D3D10";
		case reshade::api::device_api::d3d11:
			return "D3D11";
		case reshade::api::device_api::d3d12:
			return "D3D12";
		case reshade::api::device_api::opengl:
			return "OpenGL";
		case reshade::api::device_api::vulkan:
			return "Vulkan";
		default:
			return "unknown";
		}
	}

	void add_issue(std::string problem, std::string action)
	{
		g_dlss.issues.push_back({std::move(problem), std::move(action)});
	}

	void refresh_dlss_diagnostics(reshade::api::effect_runtime *runtime)
	{
		const ULONGLONG now = GetTickCount64();
		if (now - g_dlss.last_poll < diagnostics_poll_interval_ms)
			return;
		g_dlss.last_poll = now;
		g_dlss.issues.clear();
		g_dlss.delivery_proven = false;

		const std::filesystem::path bridge_path = g_module_dir / L"dlss5-dx11-bridge.addon64";
		const std::filesystem::path renodx_path = g_module_dir / L"renodx-dlss5-v2.5.addon64";
		const std::filesystem::path dlss_path = g_module_dir / L"nvngx_dlss.dll";
		const std::filesystem::path dlssnr_path = g_module_dir / L"nvngx_dlssnr.dll";
		g_dlss.bridge_installed = std::filesystem::exists(bridge_path);
		g_dlss.renodx_installed = std::filesystem::exists(renodx_path);
		g_dlss.dlss_installed = std::filesystem::exists(dlss_path);
		g_dlss.dlssnr_installed = std::filesystem::exists(dlssnr_path);
		g_dlss.bridge_loaded = GetModuleHandleW(L"dlss5-dx11-bridge.addon64") != nullptr;
		g_dlss.renodx_loaded = GetModuleHandleW(L"renodx-dlss5-v2.5.addon64") != nullptr;
		g_dlss.available = g_dlss.bridge_installed || g_dlss.renodx_installed;
		if (!g_dlss.available)
		{
			g_dlss.health = health_level::ready;
			return;
		}

		if (runtime != nullptr && runtime->get_device() != nullptr)
			g_dlss.runtime_api = api_name(runtime->get_device()->get_api());
		if (g_dlss.runtime_api != "D3D11")
			add_issue("当前 ReShade 运行时不是 D3D11。", "关闭当前客户端，启动 D3D11 构建。");

		if (!g_dlss.bridge_installed || !g_dlss.bridge_loaded)
			add_issue("DX11 bridge 未安装或未加载。", "关闭客户端并运行 Install-DLSS5.cmd。");
		if (!g_dlss.renodx_installed || !g_dlss.renodx_loaded)
			add_issue("RenoDX DLSS5 插件未安装或未加载。", "关闭客户端并运行 Install-DLSS5.cmd。");
		if (!g_dlss.dlss_installed || !g_dlss.dlssnr_installed)
			add_issue("DLSS 运行库不完整。", "关闭客户端并运行 Install-DLSS5.cmd。");

		const std::filesystem::path reshade_ini = g_module_dir / L"ReShade.ini";
		g_dlss.neural_uplift = read_ini_value(reshade_ini, L"RenoDX.DLSS5", L"NeuralUplift").value_or("missing");
		g_dlss.nr_preset = read_ini_value(reshade_ini, L"RenoDX.DLSS5", L"NRPreset").value_or("missing");
		g_dlss.nr_style = read_ini_value(reshade_ini, L"RenoDX.DLSS5", L"NRStyle").value_or("missing");
		if (g_dlss.neural_uplift != "0")
			add_issue("NeuralUplift=" + g_dlss.neural_uplift + "，不符合 RTX 40 安全配置。",
				"关闭 NeuralUplift，将 ReShade.ini 中的值设为 0。");

		std::filesystem::path bridge_cfg = g_module_dir / L"dlss5-dx11-bridge.cfg";
		if (!std::filesystem::exists(bridge_cfg))
			bridge_cfg = g_module_dir / L"dlss5-bridge.cfg";
		g_dlss.stage = parse_config_int(bridge_cfg, "stage");
		g_dlss.mode = parse_config_int(bridge_cfg, "mode");
		g_dlss.skip_exe = parse_config_int(bridge_cfg, "skip_exe");
		if (g_dlss.stage != 3 || g_dlss.mode != 2)
			add_issue("Bridge 未处于完整交付模式。", "将 bridge 配置设为 stage=3、mode=2。");
		if (g_dlss.skip_exe != 2)
			add_issue("skip_exe 不是 RTX 4080 的安全值 2。", "将 bridge 配置设为 skip_exe=2 后重启。");

		const std::filesystem::path settings = (g_module_dir / L"..\\..\\Saved\\Config\\WindowsNoEditor\\GameUserSettings.ini").lexically_normal();
		const auto width = read_ini_value(settings, L"/Script/Seria.SeriaGameUserSettings", L"ResolutionSizeX");
		const auto height = read_ini_value(settings, L"/Script/Seria.SeriaGameUserSettings", L"ResolutionSizeY");
		g_dlss.resolution_x = width ? std::atoi(width->c_str()) : 0;
		g_dlss.resolution_y = height ? std::atoi(height->c_str()) : 0;
		if (g_dlss.resolution_x != 2560 || g_dlss.resolution_y != 1440)
			add_issue("当前分辨率不是已验证的 2560x1440。", "关闭客户端，将分辨率设为 2560x1440 后重启。");

		const std::filesystem::path bridge_log = g_module_dir / L"dlss5-dx11-bridge.log";
		FILETIME bridge_log_time = {};
		if (get_file_time(bridge_log, bridge_log_time) && is_current_process_file(bridge_log_time))
		{
			const std::string tail = read_tail(bridge_log, max_file_bytes);
			const log_match failure = last_matching_line(tail, {
				"stopped:", "disabled after", "session failed", "CreateFeature failed", "FeatureNotSupported"
			});
			const log_match active = last_matching_line(tail, {
				" frames: bridge CPU", " frame ", " delivered ("
			});
			const log_match ready = last_matching_line(tail, {
				"session ready:", "feature ready:"
			});
			if (failure && (!active || failure.position > active.position))
			{
				g_dlss.bridge_evidence = trim_evidence(failure.line);
				add_issue("Bridge 报告运行失败。", "打开 dlss5-dx11-bridge.log，按最后一条失败原因处理。");
			}
			else if (active)
			{
				g_dlss.bridge_evidence = trim_evidence(active.line);
				g_dlss.delivery_proven = true;
			}
			else if (ready)
			{
				g_dlss.bridge_evidence = trim_evidence(ready.line);
			}
			else
			{
				g_dlss.bridge_evidence = "Bridge log is current; waiting for a delivered frame.";
			}
		}
		else
		{
			g_dlss.bridge_evidence = "No current-session bridge log.";
		}

		const std::filesystem::path reshade_log = g_module_dir / L"ReShade.log";
		FILETIME reshade_log_time = {};
		if (get_file_time(reshade_log, reshade_log_time) && is_current_process_file(reshade_log_time))
		{
			const std::string tail = read_tail(reshade_log, max_file_bytes);
			const log_match success = last_matching_line(tail, {
				"inline feature 18 evaluation succeeded"
			}, "[DLSS 5 Neural Rendering]");
			const log_match failure = last_matching_line(tail, {
				"| ERROR |", "FeatureNotSupported", " failed", "Failed"
			}, "[DLSS 5 Neural Rendering]");
			if (failure && (!success || failure.position > success.position))
			{
				g_dlss.renodx_evidence = trim_evidence(failure.line);
				add_issue("RenoDX DLSS5 报告运行失败。",
					"打开 ReShade.log，定位最后一条 [DLSS 5 Neural Rendering] 错误并按错误内容处理。");
			}
			else if (success)
			{
				g_dlss.renodx_evidence = trim_evidence(success.line);
				g_dlss.delivery_proven = true;
			}
			else
			{
				g_dlss.renodx_evidence = "RenoDX is loaded; no evaluation evidence yet.";
			}
		}
		else
		{
			g_dlss.renodx_evidence = "No current-session ReShade log.";
		}

		g_dlss.health = !g_dlss.issues.empty()
			? health_level::check
			: g_dlss.delivery_proven ? health_level::active : health_level::ready;
	}

	void initialize_runtime_state(reshade::api::effect_runtime *runtime)
	{
		if (g_initialized)
			return;
		g_initialized = true;

		wchar_t module_path[MAX_PATH] = {};
		GetModuleFileNameW(g_module, module_path, static_cast<DWORD>(std::size(module_path)));
		g_module_dir = std::filesystem::path(module_path).parent_path();
		g_snapshots.initialize((g_module_dir / L"..\\..\\Saved").lexically_normal());
		FILETIME exit_time = {};
		FILETIME kernel_time = {};
		FILETIME user_time = {};
		GetProcessTimes(GetCurrentProcess(), &g_process_start_time, &exit_time, &kernel_time, &user_time);

		bool configured_visibility = true;
		if (reshade::get_config_value(nullptr, "SeriaQAOverlay", "HudVisible", configured_visibility))
			g_hud_visible = configured_visibility;
		int configured_opacity = g_hud_opacity_percent;
		if (reshade::get_config_value(nullptr, "SeriaQAOverlay", "HudOpacity", configured_opacity))
			g_hud_opacity_percent = std::clamp(configured_opacity, 25, 100);
		bool configured_full_reshade = false;
		if (reshade::get_config_value(
			nullptr, "SeriaQAOverlay", "HomeOpensFullReShade", configured_full_reshade))
			g_home_opens_full_reshade = configured_full_reshade;

		g_snapshots.poll();
		refresh_dlss_diagnostics(runtime);
	}

	const seria_qa::task_record *find_task(const snapshot &data, int64_t task_id)
	{
		const auto found = std::find_if(data.tasks.begin(), data.tasks.end(),
			[task_id](const seria_qa::task_record &task) { return task.task_id == task_id; });
		return found == data.tasks.end() ? nullptr : &*found;
	}

	const seria_qa::task_record *primary_task(const snapshot &data)
	{
		for (const int64_t candidate : {data.focus.task_id, data.navigation.task_id, data.dialogue.task_id})
		{
			if (candidate <= 0) continue;
			if (std::count_if(data.tasks.begin(), data.tasks.end(),
				[candidate](const auto &task) { return task.task_id == candidate; }) > 1)
				return nullptr; // Focus records do not qualify task identity by origin.
			const auto *task = find_task(data, candidate);
			if (task != nullptr && task->status == 1) return task;
		}
		for (const seria_qa::task_record &task : data.tasks)
			if (task.status == 1 && task.active && task.traced && !task.subtask)
				return &task;
		for (const seria_qa::task_record &task : data.tasks)
			if (task.status == 1 && task.active && task.traced)
				return &task;
		for (const seria_qa::task_record &task : data.tasks)
			if (task.status == 1 && task.active)
				return &task;
		for (const seria_qa::task_record &task : data.tasks)
			if (task.status == 1)
				return &task;
		return nullptr;
	}

	const char *status_name(int status)
	{
		switch (status)
		{
		case -1:
			return "已放弃";
		case 1:
			return "进行中";
		case 2:
			return "已完成";
		case 3:
			return "已提交";
		case 4:
			return "失败";
		default:
			return "未知";
		}
	}

	const char *status_marker(int status)
	{
		switch (status)
		{
		case -1:
			return "x";
		case 1:
			return ">";
		case 2:
			return "v";
		case 3:
			return "#";
		case 4:
			return "!";
		default:
			return "?";
		}
	}

	ImVec4 status_color(int status)
	{
		switch (status)
		{
		case -1:
		case 4:
			return color_red;
		case 1:
			return color_cyan;
		case 2:
		case 3:
			return color_muted;
		default:
			return color_muted;
		}
	}

	const char *event_name(std::string_view kind)
	{
		if (kind == "accepted") return "接取";
		if (kind == "refresh") return "刷新";
		if (kind == "finished") return "完成";
		if (kind == "committed") return "提交";
		if (kind == "removed") return "移除";
		if (kind == "failed") return "失败";
		if (kind == "abandon") return "放弃";
		if (kind == "active") return "激活";
		if (kind == "deactive") return "停用";
		if (kind == "trace") return "追踪";
		if (kind == "line_finished") return "任务线完成";
		if (kind == "task_list") return "任务列表就绪";
		if (kind == "reset") return "任务数据重置";
		if (kind == "guide_add") return "导航目标加入";
		if (kind == "guide_remove") return "导航目标移除";
		if (kind == "guide_refresh") return "导航目标刷新";
		if (kind == "nav_start") return "开始寻路";
		if (kind == "nav_end") return "寻路结束";
		if (kind == "dialog_start") return "对话开始";
		if (kind == "dialog_step") return "对话推进";
		if (kind == "dialog_end") return "对话结束";
		if (kind == "focus") return "切换焦点";
		return "状态变化";
	}

	const char *focus_source_name(std::string_view source)
	{
		if (source == "navigation") return "导航";
		if (source == "dialogue") return "对话";
		if (source == "handled") return "最近操作";
		if (source == "hud") return "游戏任务栏";
		if (source == "traced") return "追踪任务线";
		return "未知";
	}

	const char *dialogue_type_name(const seria_qa::dialogue_record &dialogue)
	{
		if (dialogue.complex_chat) return "复杂闲话";
		if (dialogue.camera_dialog) return "镜头对话";
		if (dialogue.task_id > 0) return "任务对白";
		return "普通对话";
	}

	ImVec4 dialogue_type_color(const seria_qa::dialogue_record &dialogue)
	{
		if (dialogue.complex_chat) return color_yellow;
		if (dialogue.camera_dialog) return color_cyan;
		if (dialogue.task_id > 0) return color_text;
		return color_muted;
	}

	ImVec4 event_color(const seria_qa::event_record &event)
	{
		if (event.kind == "failed" || event.kind == "abandon")
			return color_red;
		if (event.kind == "finished" || event.kind == "committed" ||
			event.kind == "line_finished")
			return color_cyan;
		return color_yellow;
	}

	void remember_task_change(
		const seria_qa::event_record &event,
		ULONGLONG expires_at)
	{
		if (event.task_id <= 0)
			return;
		g_recent_task_changes.erase(std::remove_if(
			g_recent_task_changes.begin(), g_recent_task_changes.end(),
			[&event](const recent_task_change &change) {
				return change.task_id == event.task_id;
			}), g_recent_task_changes.end());
		g_recent_task_changes.push_back({
			event.task_id,
			event.sequence,
			event.time_ms,
			expires_at,
			event.kind,
			event.label,
		});
	}

	void update_task_changes(const snapshot &data)
	{
		const ULONGLONG now = GetTickCount64();
		g_recent_task_changes.erase(std::remove_if(
			g_recent_task_changes.begin(), g_recent_task_changes.end(),
			[now](const recent_task_change &change) {
				return now >= change.expires_at;
			}), g_recent_task_changes.end());

		if (data.sequence < g_activity_snapshot_sequence)
		{
			g_activity_initialized = false;
			g_last_event_sequence = 0;
			g_last_event_time_ms = 0;
			g_recent_task_changes.clear();
		}
		g_activity_snapshot_sequence = data.sequence;

		if (!g_activity_initialized)
		{
			for (const seria_qa::event_record &event : data.events)
			{
				if (event.time_ms > g_last_event_time_ms ||
					(event.time_ms == g_last_event_time_ms &&
						event.sequence > g_last_event_sequence))
				{
					g_last_event_time_ms = event.time_ms;
					g_last_event_sequence = event.sequence;
				}
				const int64_t age = data.generated_at_ms - event.time_ms;
				if (event.task_id > 0 && age >= 0 &&
					age < static_cast<int64_t>(task_change_highlight_ms))
				{
					remember_task_change(event,
						now + task_change_highlight_ms - static_cast<ULONGLONG>(age));
				}
			}
			g_activity_initialized = true;
			return;
		}

		for (const seria_qa::event_record &event : data.events)
		{
			const bool unseen = event.time_ms > g_last_event_time_ms ||
				(event.time_ms == g_last_event_time_ms &&
					event.sequence > g_last_event_sequence);
			if (!unseen)
				continue;
			remember_task_change(event, now + task_change_highlight_ms);
			g_last_event_time_ms = event.time_ms;
			g_last_event_sequence = event.sequence;
		}
	}

	const recent_task_change *recent_change_for(int64_t task_id)
	{
		const auto found = std::find_if(
			g_recent_task_changes.begin(), g_recent_task_changes.end(),
			[task_id](const recent_task_change &change) {
				return change.task_id == task_id;
			});
		return found == g_recent_task_changes.end() ? nullptr : &*found;
	}

	ImVec4 task_change_color(const recent_task_change &change)
	{
		if (change.kind == "failed" || change.kind == "abandon")
			return color_red;
		if (change.kind == "finished" || change.kind == "committed" ||
			change.kind == "line_finished")
			return color_cyan;
		return color_yellow;
	}

	bool task_activity_before(
		const seria_qa::task_record *left,
		const seria_qa::task_record *right,
		const seria_qa::task_record *current)
	{
		const recent_task_change *const left_change = recent_change_for(left->task_id);
		const recent_task_change *const right_change = recent_change_for(right->task_id);
		if ((left_change != nullptr) != (right_change != nullptr))
			return left_change != nullptr;
		if (left_change != nullptr && right_change != nullptr)
		{
			if (left_change->event_time_ms != right_change->event_time_ms)
				return left_change->event_time_ms > right_change->event_time_ms;
			if (left_change->event_sequence != right_change->event_sequence)
				return left_change->event_sequence > right_change->event_sequence;
		}

		const bool left_current = current != nullptr &&
			left->task_id == current->task_id && left->client == current->client;
		const bool right_current = current != nullptr &&
			right->task_id == current->task_id && right->client == current->client;
		if (left_current != right_current)
			return left_current;
		if (left->active != right->active)
			return left->active;
		if (left->traced != right->traced)
			return left->traced;
		if (left->task_id != right->task_id)
			return left->task_id < right->task_id;
		return left->client < right->client;
	}

	std::string shortened(std::string_view text, size_t max_bytes)
	{
		if (text.size() <= max_bytes)
			return std::string(text);
		size_t cut = max_bytes;
		while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xc0) == 0x80)
			--cut;
		return std::string(text.substr(0, cut)) + "...";
	}

	// UTF-8 safe trim so the result (plus ellipsis) fits the pixel width.
	std::string fit_to_width(std::string text, float max_width)
	{
		if (ImGui::CalcTextSize(text.c_str()).x <= max_width)
			return text;
		while (!text.empty())
		{
			size_t cut = text.size() - 1;
			while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xc0) == 0x80)
				--cut;
			text.resize(cut);
			const std::string candidate = text + "...";
			if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width)
				return candidate;
		}
		return "...";
	}

	void push_overlay_style()
	{
		ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 3.0f);
		ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 2.0f);
		ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 2.0f);
		ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f, 9.0f));
		ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(7.0f, 4.0f));
		ImGui::PushStyleColor(ImGuiCol_WindowBg, color_bg);
		ImGui::PushStyleColor(ImGuiCol_ChildBg, color_panel);
		ImGui::PushStyleColor(ImGuiCol_Text, color_text);
		ImGui::PushStyleColor(ImGuiCol_TextDisabled, color_muted);
		ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.29f, 0.29f, 0.31f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.24f, 0.30f, 0.38f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.29f, 0.32f, 0.37f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.30f, 0.38f, 0.47f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_TableRowBgAlt, ImVec4(0.20f, 0.20f, 0.21f, 0.66f));
		ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.29f, 0.29f, 0.31f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.30f, 0.34f, 0.39f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.24f, 0.24f, 0.26f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.34f, 0.38f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.30f, 0.38f, 0.47f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_CheckMark, color_cyan);
		ImGui::PushStyleColor(ImGuiCol_SliderGrab, color_muted);
		ImGui::PushStyleColor(ImGuiCol_SliderGrabActive, color_cyan);
		ImGui::PushStyleColor(ImGuiCol_Tab, color_panel);
		ImGui::PushStyleColor(ImGuiCol_TabHovered, ImVec4(0.30f, 0.34f, 0.39f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_TabSelected, ImVec4(0.24f, 0.30f, 0.38f, 1.0f));
		ImGui::PushStyleColor(ImGuiCol_TabSelectedOverline, color_cyan);
	}

	void pop_overlay_style()
	{
		ImGui::PopStyleColor(22);
		ImGui::PopStyleVar(5);
	}

	void text_status(const char *marker, const ImVec4 &color, const char *format, ...)
	{
		ImGui::TextColored(color, "%s", marker);
		ImGui::SameLine(0.0f, 6.0f);
		va_list args;
		va_start(args, format);
		ImGui::TextV(format, args);
		va_end(args);
	}

	void text_status_wrapped(const char *marker, const ImVec4 &color, const char *format, ...)
	{
		ImGui::TextColored(color, "%s", marker);
		ImGui::SameLine(0.0f, 6.0f);
		va_list args;
		va_start(args, format);
		ImGui::TextWrappedV(format, args);
		va_end(args);
	}

	void text_wrapped_colored(const ImVec4 &color, const char *format, ...)
	{
		ImGui::PushStyleColor(ImGuiCol_Text, color);
		va_list args;
		va_start(args, format);
		ImGui::TextWrappedV(format, args);
		va_end(args);
		ImGui::PopStyleColor();
	}

	void heading_text(const char *text, const ImVec4 &color, float scale = 1.06f)
	{
		ImGui::PushFont(nullptr, ImGui::GetStyle().FontSizeBase * scale);
		ImGui::TextColored(color, "%s", text);
		ImGui::PopFont();
	}

	int progress_percent(int completed_nodes, int total_nodes)
	{
		if (total_nodes <= 0)
			return 0;
		const int64_t scaled = static_cast<int64_t>(completed_nodes) * 100;
		return std::clamp(
			static_cast<int>((scaled + total_nodes / 2) / total_nodes),
			0, 100);
	}

	int progress_percent(const seria_qa::focus_record &focus)
	{
		return focus.progress_known
			? progress_percent(focus.completed_nodes, focus.total_nodes)
			: 0;
	}

	const seria_qa::progress_record *progress_for_task(
		const snapshot &data,
		int64_t task_id)
	{
		const auto found = std::find_if(data.progress.begin(), data.progress.end(),
			[task_id](const seria_qa::progress_record &record) {
				return record.task_id == task_id;
			});
		return found == data.progress.end() ? nullptr : &*found;
	}

	struct task_progress_presentation
	{
		std::string text = "--";
		ImVec4 color;
		bool known = false;
	};

	// User-facing completion text for one held task. Finished/committed tasks
	// read 100%; failed tasks show structural progress in red; abandoned or
	// unresolvable task lines stay "--" instead of a fabricated number.
	task_progress_presentation present_task_progress(
		const snapshot &data,
		const seria_qa::task_record &task)
	{
		task_progress_presentation result;
		result.color = color_muted;
		if (task.status == 2 || task.status == 3)
		{
			result.text = "100%";
			result.color = color_cyan;
			result.known = true;
			return result;
		}
		if (task.status == -1)
			return result;

		const seria_qa::progress_record *const progress =
			progress_for_task(data, task.task_id);
		if (progress == nullptr || !progress->progress_known)
			return result;

		const int percent =
			progress_percent(progress->completed_nodes, progress->total_nodes);
		result.text = std::to_string(percent) + "%";
		result.known = true;
		result.color = task.status == 4 ? color_red : color_cyan;
		return result;
	}

	void draw_progress_ring(
		const seria_qa::focus_record &focus,
		float diameter,
		const char *id)
	{
		constexpr float tau = 6.2831853071795864769f;
		constexpr float start_angle = -1.5707963267948966192f;
		const ImVec2 top_left = ImGui::GetCursorScreenPos();
		ImGui::PushID(id);
		ImGui::Dummy(ImVec2(diameter, diameter));
		ImGui::PopID();

		ImDrawList *const draw = ImGui::GetWindowDrawList();
		const ImVec2 center(top_left.x + diameter * 0.5f, top_left.y + diameter * 0.5f);
		const float radius = diameter * 0.39f;
		const float stroke = std::max(3.0f, diameter * 0.065f);
		draw->PathArcTo(center, radius, start_angle, start_angle + tau, 64);
		draw->PathStroke(ImGui::GetColorU32(ImVec4(0.29f, 0.29f, 0.31f, 1.0f)), 0, stroke);

		const int percent = progress_percent(focus);
		const float ratio = static_cast<float>(percent) / 100.0f;
		if (focus.progress_known && ratio > 0.0f)
		{
			draw->PathArcTo(center, radius, start_angle, start_angle + tau * ratio, 64);
			draw->PathStroke(ImGui::GetColorU32(color_cyan), 0, stroke);
		}

		const int point_count = focus.progress_known
			? std::clamp(focus.total_nodes, 1, 12)
			: 0;
		const int current_point = point_count > 0
			? std::clamp(static_cast<int>(ratio * point_count), 0, point_count - 1)
			: -1;
		for (int index = 0; index < point_count; ++index)
		{
			const float point_ratio =
				(static_cast<float>(index) + 0.5f) / static_cast<float>(point_count);
			const float angle = start_angle + tau * point_ratio;
			const ImVec2 point(
				center.x + std::cos(angle) * radius,
				center.y + std::sin(angle) * radius);
			const bool completed = point_ratio <= ratio;
			const bool current = !completed && index == current_point;
			const ImVec4 fill = completed ? color_cyan :
				current ? color_yellow : ImVec4(0.38f, 0.39f, 0.41f, 1.0f);
			draw->AddCircleFilled(point, current ? stroke * 0.72f : stroke * 0.58f,
				ImGui::GetColorU32(fill), 12);
			draw->AddCircle(point, current ? stroke * 0.72f : stroke * 0.58f,
				ImGui::GetColorU32(color_panel), 12, 1.0f);
		}

		char label[16] = "--";
		if (focus.progress_known)
			std::snprintf(label, sizeof(label), "%d%%", percent);
		const ImVec2 label_size = ImGui::CalcTextSize(label);
		draw->AddText(
			ImVec2(center.x - label_size.x * 0.5f, center.y - label_size.y * 0.5f),
			ImGui::GetColorU32(focus.progress_known ? color_text : color_muted),
			label);
	}

	size_t completed_task_count(const snapshot &data)
	{
		return static_cast<size_t>(std::count_if(data.tasks.begin(), data.tasks.end(),
			[](const seria_qa::task_record &task) { return task.status == 2 || task.status == 3; }));
	}

	constexpr float chip_pad_x = 8.0f;
	constexpr float chip_pad_y = 3.5f;
	constexpr float chip_gap_x = 6.0f;
	constexpr float chip_gap_y = 4.0f;
	constexpr int max_chip_lines = 2;

	// One compact chip: task id and name in a single tinted block. The tint is
	// semantic - recent change, current (cyan), or the task's own status.
	void draw_task_activity_chip(
		ImDrawList *draw,
		const ImVec2 &top_left,
		float width,
		float height,
		const seria_qa::task_record &task,
		bool current)
	{
		const recent_task_change *const change = recent_change_for(task.task_id);
		const ImVec4 ink = change != nullptr
			? task_change_color(*change)
			: current ? color_cyan : status_color(task.status);

		const float fill_alpha = change != nullptr ? 0.20f : current ? 0.14f : 0.10f;
		draw->AddRectFilled(top_left,
			ImVec2(top_left.x + width, top_left.y + height),
			ImGui::GetColorU32(ImVec4(ink.x, ink.y, ink.z, fill_alpha)), 4.0f);
		draw->AddRect(top_left,
			ImVec2(top_left.x + width, top_left.y + height),
			ImGui::GetColorU32(ImVec4(ink.x, ink.y, ink.z,
				change != nullptr ? 0.95f : 0.65f)), 4.0f);

		std::string label = "[" + std::to_string(task.task_id) + "] ";
		label += task.name.empty() ? "未命名任务" : task.name;
		label = fit_to_width(std::move(label), width - chip_pad_x * 2.0f);
		draw->AddText(
			ImVec2(top_left.x + chip_pad_x, top_left.y + chip_pad_y),
			ImGui::GetColorU32(ink), label.c_str());
	}

	void draw_task_activity_strip(
		const snapshot &data,
		const seria_qa::task_record *current)
	{
		if (data.tasks.empty())
			return;

		std::vector<const seria_qa::task_record *> tasks;
		tasks.reserve(data.tasks.size());
		for (const seria_qa::task_record &task : data.tasks)
			tasks.push_back(&task);
		std::stable_sort(tasks.begin(), tasks.end(),
			[current](const auto *left, const auto *right) {
				return task_activity_before(left, right, current);
			});

		const recent_task_change *latest = nullptr;
		for (const recent_task_change &change : g_recent_task_changes)
		{
			if (std::none_of(tasks.begin(), tasks.end(),
				[&change](const auto *task) { return task->task_id == change.task_id; }))
				continue;
			if (latest == nullptr ||
				change.event_time_ms > latest->event_time_ms ||
				(change.event_time_ms == latest->event_time_ms &&
					change.event_sequence > latest->event_sequence))
				latest = &change;
		}

		ImGui::Separator();
		if (latest != nullptr)
		{
			ImGui::TextColored(task_change_color(*latest), "%s  [%lld] %s",
				event_name(latest->kind),
				static_cast<long long>(latest->task_id),
				latest->label.empty() ? "任务状态已变化" : latest->label.c_str());
		}
		else
		{
			ImGui::TextDisabled("任务状态");
		}

		const ImVec2 origin = ImGui::GetCursorScreenPos();
		const float row_width = ImGui::GetContentRegionAvail().x;
		const float right_edge = origin.x + row_width;
		const float row_height = ImGui::GetTextLineHeight() + chip_pad_y * 2.0f;
		ImDrawList *const draw = ImGui::GetWindowDrawList();

		float x = origin.x;
		float y = origin.y;
		int lines_used = 1;
		size_t hidden = 0;

		for (size_t index = 0; index < tasks.size(); ++index)
		{
			const seria_qa::task_record &task = *tasks[index];
			std::string label = "[" + std::to_string(task.task_id) + "] ";
			label += task.name.empty() ? "未命名任务" : task.name;
			label = fit_to_width(std::move(label),
				row_width - chip_pad_x * 2.0f);
			const float width =
				ImGui::CalcTextSize(label.c_str()).x + chip_pad_x * 2.0f;

			if (x + width > right_edge && x > origin.x)
			{
				if (lines_used == max_chip_lines)
				{
					hidden = tasks.size() - index;
					break;
				}
				x = origin.x;
				y += row_height + chip_gap_y;
				++lines_used;
			}

			const bool is_current = current != nullptr &&
				task.task_id == current->task_id && task.client == current->client;
			draw_task_activity_chip(draw, ImVec2(x, y), width, row_height,
				task, is_current);
			x += width + chip_gap_x;
		}

		if (hidden > 0)
		{
			const std::string label = "+" + std::to_string(hidden);
			float width =
				ImGui::CalcTextSize(label.c_str()).x + chip_pad_x * 2.0f;
			if (x + width > right_edge && x > origin.x &&
				lines_used < max_chip_lines)
			{
				x = origin.x;
				y += row_height + chip_gap_y;
				++lines_used;
			}
			draw->AddRectFilled(ImVec2(x, y),
				ImVec2(x + width, y + row_height),
				ImGui::GetColorU32(ImVec4(0.30f, 0.30f, 0.32f, 0.18f)), 4.0f);
			draw->AddRect(ImVec2(x, y),
				ImVec2(x + width, y + row_height),
				ImGui::GetColorU32(ImVec4(0.40f, 0.40f, 0.42f, 0.7f)), 4.0f);
			draw->AddText(ImVec2(x + chip_pad_x, y + chip_pad_y),
				ImGui::GetColorU32(color_muted), label.c_str());
		}

		ImGui::Dummy(ImVec2(row_width, y + row_height - origin.y));
	}

	void draw_hud_task(
		const seria_qa::task_record &task,
		const seria_qa::focus_record *focus)
	{
		if (focus != nullptr)
		{
			draw_progress_ring(*focus, 72.0f, "hud-progress");
			ImGui::SameLine(0.0f, 10.0f);
			ImGui::BeginGroup();
		}
		ImGui::TextColored(status_color(task.status), "%s", status_marker(task.status));
		ImGui::SameLine(0.0f, 6.0f);
		const std::string name = shortened(task.name.empty() ? "(unnamed task)" : task.name, 88);
		ImGui::Text("[%lld] %s", static_cast<long long>(task.task_id), name.c_str());
		if (!task.description.empty())
			ImGui::TextWrapped("  %s", task.description.c_str());
		ImGui::TextColored(color_muted, "  %s", status_name(task.status));
		if (focus != nullptr)
		{
			if (focus->progress_known)
			{
				ImGui::TextColored(color_muted, "  已完成 %d / %d 个配置节点",
					focus->completed_nodes, focus->total_nodes);
			}
			else
			{
				if (focus->task_id == task.task_id)
					ImGui::TextColored(color_muted, "  进度暂不可计算 · 后续 %d 个配置节点",
						focus->remaining_nodes);
				else
					ImGui::TextColored(color_muted, "  当前任务线进度暂不可计算");
			}
			ImGui::EndGroup();
		}
	}

	void draw_active_dialogue(
		const seria_qa::dialogue_record &dialogue,
		bool section_heading)
	{
		if (!dialogue.active)
			return;

		if (section_heading)
			ImGui::SeparatorText("当前触发");
		else
			ImGui::TextDisabled("当前触发");

		ImGui::TextColored(
			dialogue_type_color(dialogue), "%s", dialogue_type_name(dialogue));
		ImGui::SameLine(0.0f, 10.0f);
		ImGui::Text("开始 ID  %lld", static_cast<long long>(dialogue.start_id));
		ImGui::Text("当前句 ID  %lld", static_cast<long long>(dialogue.current_id));
		if (dialogue.task_id > 0)
		{
			ImGui::SameLine(0.0f, 12.0f);
			ImGui::TextDisabled(
				"关联任务 %lld · 任务线 %lld",
				static_cast<long long>(dialogue.task_id),
				static_cast<long long>(dialogue.task_line_id));
		}
	}

	void draw_hud(reshade::api::effect_runtime *runtime)
	{
		initialize_runtime_state(runtime);
		g_snapshots.poll();
		update_gm_submission(g_snapshots.is_live());
		if (g_snapshots.current)
			update_task_changes(*g_snapshots.current);

		const bool chord_down = runtime->is_key_down(VK_HOME) && runtime->is_key_down(VK_CONTROL);
		if (chord_down && !g_toggle_chord_down)
		{
			g_hud_visible = !g_hud_visible;
			reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudVisible", g_hud_visible);
		}
		g_toggle_chord_down = chord_down;
		if (!g_hud_visible || g_overlay_open || g_task_workspace_open)
			return;

		refresh_dlss_diagnostics(runtime);

		const ImVec2 display = ImGui::GetIO().DisplaySize;
		const float width = std::clamp(display.x * 0.27f, 420.0f, 560.0f);
		ImGui::SetNextWindowPos(ImVec2(16.0f, 62.0f), ImGuiCond_Always);
		ImGui::SetNextWindowSize(ImVec2(width, 0.0f), ImGuiCond_Always);
		ImGui::SetNextWindowBgAlpha(static_cast<float>(g_hud_opacity_percent) / 100.0f);

		push_overlay_style();
		const ImGuiWindowFlags flags =
			ImGuiWindowFlags_NoDecoration |
			ImGuiWindowFlags_NoInputs |
			ImGuiWindowFlags_NoNav |
			ImGuiWindowFlags_NoFocusOnAppearing |
			ImGuiWindowFlags_NoBringToFrontOnFocus |
			ImGuiWindowFlags_NoSavedSettings |
			ImGuiWindowFlags_AlwaysAutoResize;
		if (ImGui::Begin("Seria QA HUD", nullptr, flags))
		{
			heading_text("当前任务", color_text, 1.08f);
			ImGui::SameLine();
			if (g_snapshots.current)
			{
				ImGui::TextColored(g_snapshots.is_live() ? color_muted : color_yellow,
					g_snapshots.is_live() ? "实时" : "数据暂停");
			}
			else
				ImGui::TextColored(color_red, "未连接");
			ImGui::Separator();

			if (!g_snapshots.current)
			{
				text_status("!", color_red, "任务数据离线");
				if (g_gm_submission == gm_submission_phase::failed &&
					g_pending_gm_is_capture)
					ImGui::TextWrapped("%s", g_gm_submission_error.c_str());
				else if (gm_submission_running() && g_pending_gm_is_capture)
					ImGui::TextWrapped("正在通过游戏 GM 面板启动任务采集...");
				else
					ImGui::TextWrapped("进入角色后按 Home，在“全部任务”中点击“一键启动采集”。");
				if (!g_snapshots.error.empty())
					ImGui::TextDisabled("%s", g_snapshots.error.c_str());
			}
			else
			{
				const snapshot &data = *g_snapshots.current;
				if (!g_snapshots.is_live())
				{
					text_status_wrapped("!", color_yellow, "任务快照已停止实时更新：%s", g_snapshots.error.c_str());
					text_wrapped_colored(color_muted,
						"当前显示最后一次有效数据；确认客户端仍在运行且 Saved 目录可写。");
					ImGui::Separator();
				}
				if (data.dialogue.active)
				{
					draw_active_dialogue(data.dialogue, false);
					ImGui::Separator();
				}
				const seria_qa::task_record *const task = primary_task(data);
				if (task != nullptr)
				{
					const seria_qa::focus_record unknown_focus = {};
					const seria_qa::focus_record *const focus =
						data.focus.task_id == task->task_id ? &data.focus : &unknown_focus;
					draw_hud_task(*task, focus);
				}
				else
				{
					const size_t completed = completed_task_count(data);
					const bool has_processing = std::any_of(data.tasks.begin(), data.tasks.end(),
						[](const auto &record) { return record.status == 1; });
					text_status_wrapped("-", color_muted, has_processing
						? "当前任务编号存在多条记录，请按 Home 按来源查看。"
						: data.task_list_ready ? "当前没有进行中任务" : "等待任务列表");
					if (completed > 0)
						ImGui::TextDisabled("  已完成或提交 %zu 个节点", completed);
				}

				int next_shown = 0;
				int next_total = 0;
				if (task != nullptr)
				{
					for (const seria_qa::next_record &next : data.next)
					{
						if (next.parent_task_id != task->task_id || !next.selected)
							continue;
						++next_total;
						if (next_shown < 2)
						{
							ImGui::TextColored(color_yellow, "+");
							ImGui::SameLine(0.0f, 6.0f);
							const std::string name = shortened(next.name.empty() ? "(unnamed task)" : next.name, 76);
							ImGui::Text("下一候选 [%lld] %s", static_cast<long long>(next.task_id), name.c_str());
							++next_shown;
						}
					}
					if (next_total > next_shown)
						ImGui::TextDisabled("  另有 %d 个候选", next_total - next_shown);
				}

				if (data.navigation.guide_active || data.navigation.auto_moving)
				text_status("", color_muted, "%s  ·  任务 %lld",
					data.navigation.auto_moving ? "正在寻路" : "导航已设置",
					static_cast<long long>(data.navigation.task_id));

				draw_task_activity_strip(data, task);
				ImGui::TextDisabled("Home 打开任务工作区  ·  共 %zu 条", data.tasks.size());
			}

			if (g_dlss.available && g_dlss.health == health_level::check)
			{
				ImGui::Separator();
				text_status("!", color_red, "DLSS5 CHECK  |  %s", g_dlss.runtime_api.c_str());
				text_status_wrapped("!", color_red, "%s", g_dlss.issues.front().problem.c_str());
				text_wrapped_colored(color_muted, "处理：%s", g_dlss.issues.front().action.c_str());
			}
		}
		ImGui::End();
		pop_overlay_style();
	}

	bool task_visible_for_filter(const seria_qa::task_record &task)
	{
		if (g_task_filter == 1 && task.status != 1) return false;
		if (g_task_filter == 2 && !task.traced) return false;
		if (g_task_filter == 3 && task.status != 2 && task.status != 3) return false;
		if (g_task_filter == 4 && task.status != -1 && task.status != 4) return false;
		if (g_task_filter == 5 && task.client) return false;
		if (g_task_filter == 6 && !task.client) return false;
		if (g_task_search[0] != '\0')
		{
			std::string query = g_task_search;
			std::string haystack = std::to_string(task.task_id) + " " + task.name;
			const auto lower = [](unsigned char c) { return static_cast<char>(std::tolower(c)); };
			std::transform(query.begin(), query.end(), query.begin(), lower);
			std::transform(haystack.begin(), haystack.end(), haystack.begin(), lower);
			if (haystack.find(query) == std::string::npos) return false;
		}
		return true;
	}

	bool task_selected(const seria_qa::task_record &task)
	{
		return g_selected_task_id == task.task_id && g_selected_task_client == task.client;
	}

	void select_task(const seria_qa::task_record &task)
	{
		g_selected_task_id = task.task_id;
		g_selected_task_client = task.client;
		if (g_selected_task_node_line_id != task.task_line_id)
		{
			g_selected_task_node_id = task.task_id;
			g_selected_task_node_line_id = task.task_line_id;
		}
	}

	void copy_task_id(int64_t task_id)
	{
		ImGui::SetClipboardText(std::to_string(task_id).c_str());
		g_copied_until = GetTickCount64() + 2000;
	}

	std::string fit_text(std::string text, float width)
	{
		if (ImGui::CalcTextSize(text.c_str()).x <= width) return text;
		while (!text.empty())
		{
			size_t cut = text.size() - 1;
			while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xc0) == 0x80) --cut;
			text.resize(cut);
			const std::string candidate = text + "...";
			if (ImGui::CalcTextSize(candidate.c_str()).x <= width) return candidate;
		}
		return "...";
	}

	void draw_task_outline(const snapshot &data, float height)
	{
		bool interaction_hint_hovered = false;
		const float toolbar_top = ImGui::GetCursorPosY();
		const float toolbar_width = ImGui::GetContentRegionAvail().x;
		const float toolbar_right = ImGui::GetCursorScreenPos().x + toolbar_width;
		const auto continue_toolbar = [toolbar_right](const char *label) {
			const float next_right = ImGui::GetItemRectMax().x + ImGui::GetStyle().ItemSpacing.x +
				ImGui::CalcTextSize(label).x + ImGui::GetStyle().FramePadding.x * 2;
			if (next_right <= toolbar_right) ImGui::SameLine();
		};
		const float filter_width = ImGui::GetFontSize() * 9.0f;
		const bool inline_search = toolbar_width >= filter_width + ImGui::GetFontSize() * 12;
		ImGui::SetNextItemWidth(inline_search
			? toolbar_width - filter_width - ImGui::GetStyle().ItemSpacing.x : toolbar_width);
		ImGui::InputTextWithHint("##task-search", "搜索编号或任务名称", g_task_search, sizeof(g_task_search));
		if (inline_search) ImGui::SameLine();
		ImGui::SetNextItemWidth(std::min(filter_width, toolbar_width));
		ImGui::Combo("##task-filter", &g_task_filter,
			"全部记录\0进行中\0已追踪\0已完成 / 提交\0异常\0服务端\0客户端\0");
		const auto *current = primary_task(data);
		ImGui::BeginDisabled(current == nullptr);
		if (ImGui::Button("定位当前任务"))
		{
			select_task(*current);
			g_task_filter = 0;
			g_task_search[0] = '\0';
			g_scroll_to_selected = true;
		}
		ImGui::EndDisabled();
		continue_toolbar("清除筛选");
		if (ImGui::Button("清除筛选"))
		{
			g_task_search[0] = '\0';
			g_task_filter = 0;
		}
		continue_toolbar("复制列表");
		if (ImGui::Button("复制列表"))
		{
			std::ostringstream text;
			text << "任务编号\t任务名称\t状态\t完成度\t来源\n";
			for (const auto &task : data.tasks)
				if (task_visible_for_filter(task))
				{
					const task_progress_presentation progress =
						present_task_progress(data, task);
					text << task.task_id << '\t' << task.name << '\t'
						<< status_name(task.status) << '\t'
						<< (progress.known ? progress.text : "") << '\t'
						<< (task.client ? "客户端" : "服务端") << '\n';
				}
			ImGui::SetClipboardText(text.str().c_str());
			g_copied_until = GetTickCount64() + 2000;
		}
		const size_t visible_count = static_cast<size_t>(std::count_if(
			data.tasks.begin(), data.tasks.end(), task_visible_for_filter));
		ImGui::TextDisabled("显示 %zu / %zu 条%s", visible_count, data.tasks.size(),
			GetTickCount64() < g_copied_until ? "  ·  已复制" : "");
		const float grid_height = std::max(100.0f, height - (ImGui::GetCursorPosY() - toolbar_top));
		if (ImGui::BeginChild("task-outline", ImVec2(0.0f, grid_height), ImGuiChildFlags_None))
		{
			if (visible_count == 0)
			{
				ImGui::TextWrapped("%s", data.tasks.empty()
					? (data.task_list_ready ? "角色当前没有任务记录。" : "正在等待角色任务列表。")
					: "没有匹配的任务，试试清除筛选或缩短关键词。");
			}
			std::vector<const seria_qa::task_record *> tasks;
			for (const auto &task : data.tasks)
				if (task_visible_for_filter(task)) tasks.push_back(&task);
			std::stable_sort(tasks.begin(), tasks.end(),
				[current](const auto *left, const auto *right) {
					return task_activity_before(left, right, current);
				});
			const float line = ImGui::GetTextLineHeight();
			const int columns = std::clamp(static_cast<int>(
				ImGui::GetContentRegionAvail().x / (line * 16.0f)), 1, 4);
			if (!tasks.empty() && ImGui::BeginTable("held-tasks", columns, ImGuiTableFlags_SizingStretchSame))
			{
				for (const auto *entry : tasks)
				{
					const auto &task = *entry;
					ImGui::TableNextColumn();
					ImGui::PushID(task.client ? "client" : "server");
					ImGui::PushID(std::to_string(task.task_id).c_str());
					const ImVec2 pos = ImGui::GetCursorScreenPos();
					const ImVec2 size(std::max(60.0f, ImGui::GetContentRegionAvail().x), line * 3.0f + 24.0f);
					if (ImGui::Selectable("##task-tile", task_selected(task), 0, size))
						select_task(task);
					if (g_scroll_to_selected && task_selected(task))
					{
						ImGui::SetScrollHereY(0.5f);
						g_scroll_to_selected = false;
					}
					const bool hovered = ImGui::IsItemHovered();
					if (hovered && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left))
						copy_task_id(task.task_id);
					const recent_task_change *const change = recent_change_for(task.task_id);
					const bool is_current = current != nullptr &&
						current->task_id == task.task_id && current->client == task.client;
					ImDrawList *draw = ImGui::GetWindowDrawList();
					draw->PushClipRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), true);
					draw->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y),
						ImGui::GetColorU32(task_selected(task) ? color_cyan :
							change != nullptr ? task_change_color(*change) :
							ImVec4(0.30f, 0.30f, 0.32f, 1)), 4.0f);
					const float ix = pos.x + 10, iy = pos.y + 10;

					const task_progress_presentation progress =
						present_task_progress(data, task);
					const float percent_width =
						ImGui::CalcTextSize(progress.text.c_str()).x;
					std::string id_text = std::to_string(task.task_id) +
						(is_current ? "  当前" : "");
					id_text = fit_text(id_text,
						std::max(24.0f, size.x - 20 - percent_width - 8));
					const ImVec4 id_color = change != nullptr
						? task_change_color(*change)
						: is_current ? color_cyan : color_text;
					draw->AddText(ImVec2(ix, iy),
						ImGui::GetColorU32(id_color), id_text.c_str());
					draw->AddText(
						ImVec2(pos.x + size.x - 10 - percent_width, iy),
						ImGui::GetColorU32(progress.color),
						progress.text.c_str());

					const std::string title = fit_text(
						task.name.empty() ? "未命名任务" : task.name, size.x - 20);
					draw->AddText(ImVec2(ix, iy + line + 3),
						ImGui::GetColorU32(color_text), title.c_str());
					const std::string meta = (change != nullptr
						? std::string(event_name(change->kind)) + " · "
						: std::string()) + status_name(task.status) +
						(task.client ? " · 客户端" : " · 服务端") +
						(task.subtask ? " · 子任务" : "") +
						(task.traced ? " · 已追踪" : "");
					draw->AddText(ImVec2(ix, iy + 2 * line + 6),
						ImGui::GetColorU32(change != nullptr
							? task_change_color(*change)
							: status_color(task.status)),
						fit_text(meta, size.x - 20).c_str());
					draw->PopClipRect();
					if (hovered)
					{
						const bool show_interaction_hint =
							g_task_interaction_hint_pending &&
							(g_task_interaction_hint_id == 0 ||
								g_task_interaction_hint_id == task.task_id);
						if (show_interaction_hint)
						{
							g_task_interaction_hint_id = task.task_id;
							interaction_hint_hovered = true;
						}
						ImGui::BeginTooltip();
						ImGui::PushTextWrapPos(ImGui::GetFontSize() * 26);
						ImGui::Text("%lld", static_cast<long long>(task.task_id));
						ImGui::TextWrapped("%s", task.name.c_str());
						ImGui::TextWrapped("%s", task.description.c_str());
						if (progress.known)
							ImGui::Text("完成度 %s", progress.text.c_str());
						if (show_interaction_hint)
							ImGui::TextDisabled("单击查看详情 · 双击复制任务 ID");
						ImGui::PopTextWrapPos();
						ImGui::EndTooltip();
					}
					ImGui::PopID();
					ImGui::PopID();
				}
				ImGui::EndTable();
			}
		}
		ImGui::EndChild();
		if (g_task_interaction_hint_pending &&
			g_task_interaction_hint_id != 0 &&
			!interaction_hint_hovered)
		{
			g_task_interaction_hint_pending = false;
			g_task_interaction_hint_id = 0;
		}
	}

	const char *task_node_status_name(const seria_qa::task_node_record &node)
	{
		if (node.status_inferred) return "路径已过";
		if (node.status == 2 || node.status == 3) return "已完成";
		if (node.status == 4) return "失败";
		if (node.status == -1) return "已放弃";
		if (node.held && node.status == 1) return "进行中";
		if (!node.selected_path) return "未选分支";
		return "未开始";
	}

	ImVec4 task_node_status_color(const seria_qa::task_node_record &node)
	{
		if (node.status == 2 || node.status == 3) return color_cyan;
		if (node.status == 4 || node.status == -1) return color_red;
		if (node.held && node.status == 1) return color_yellow;
		return color_muted;
	}

	void submit_add_task(
		reshade::api::effect_runtime *runtime,
		const seria_qa::task_node_record &node)
	{
		g_selected_task_node_id = node.task_id;
		g_selected_task_node_line_id = node.task_line_id;
		begin_whitelisted_gm_submission(
			runtime, gm_command_id::add_task, node.task_id);
	}

	void draw_task_nodes(
		reshade::api::effect_runtime *runtime,
		const snapshot &data,
		const seria_qa::task_record &selected)
	{
		std::vector<const seria_qa::task_node_record *> nodes;
		for (const seria_qa::task_node_record &node : data.task_nodes)
		{
			if (node.task_line_id == selected.task_line_id)
				nodes.push_back(&node);
		}
		std::stable_sort(nodes.begin(), nodes.end(), [](const auto *left, const auto *right) {
			if (left->order != right->order) return left->order < right->order;
			return left->task_id < right->task_id;
		});

		ImGui::SeparatorText("任务节点");
		if (nodes.empty())
		{
			ImGui::TextDisabled("当前快照没有这条任务线的节点数据。");
			return;
		}

		if (g_selected_task_node_line_id != selected.task_line_id ||
			std::none_of(nodes.begin(), nodes.end(), [](const auto *node) {
				return node->task_id == g_selected_task_node_id;
			}))
		{
			g_selected_task_node_id = selected.task_id;
			g_selected_task_node_line_id = selected.task_line_id;
		}

		const size_t completed = static_cast<size_t>(std::count_if(
			nodes.begin(), nodes.end(), [](const auto *node) {
				return node->status == 2 || node->status == 3;
			}));
		ImGui::TextDisabled("共 %zu 个节点 · 已完成 %zu 个", nodes.size(), completed);
		if (data.task_nodes_truncated)
			ImGui::TextColored(color_yellow, "节点数据达到快照上限，列表可能不完整。");

		const auto selected_node = std::find_if(
			nodes.begin(), nodes.end(), [](const auto *node) {
				return node->task_id == g_selected_task_node_id;
			});
		if (selected_node != nodes.end())
		{
			if (ImGui::SmallButton("复制节点 ID"))
				copy_task_id((*selected_node)->task_id);
			if (GetTickCount64() < g_copied_until)
			{
				ImGui::SameLine();
				ImGui::TextDisabled("已复制");
			}
		}

		const ImGuiTableFlags flags =
			ImGuiTableFlags_BordersInnerH |
			ImGuiTableFlags_RowBg |
			ImGuiTableFlags_SizingStretchProp;
		if (!ImGui::BeginTable("task-node-list", 4, flags))
			return;

		ImGui::TableSetupColumn(
			"状态", ImGuiTableColumnFlags_WidthFixed, ImGui::GetFontSize() * 5.0f);
		ImGui::TableSetupColumn(
			"任务 ID", ImGuiTableColumnFlags_WidthFixed, ImGui::GetFontSize() * 6.5f);
		ImGui::TableSetupColumn("节点", ImGuiTableColumnFlags_WidthStretch);
		ImGui::TableSetupColumn(
			"操作", ImGuiTableColumnFlags_WidthFixed, ImGui::GetFontSize() * 4.5f);
		ImGui::TableHeadersRow();

		for (const seria_qa::task_node_record *const node : nodes)
		{
			ImGui::PushID(static_cast<int>(node->task_id));
			ImGui::TableNextRow();
			const ImVec4 node_color = task_node_status_color(*node);

			ImGui::TableNextColumn();
			ImGui::TextColored(node_color, "%s", task_node_status_name(*node));

			ImGui::TableNextColumn();
			ImGui::TextColored(node_color, "%lld",
				static_cast<long long>(node->task_id));

			ImGui::TableNextColumn();
			std::string label(static_cast<size_t>(std::min(node->depth, 8)) * 2, ' ');
			if (node->branch)
				label += "分支 ";
			label += node->name.empty() ? "未命名节点" : node->name;
			const bool node_selected = node->task_id == g_selected_task_node_id;
			ImGui::PushStyleColor(ImGuiCol_Text, node_color);
			const bool activated = ImGui::Selectable(
				label.c_str(), node_selected, ImGuiSelectableFlags_AllowDoubleClick);
			ImGui::PopStyleColor();
			const bool hovered = ImGui::IsItemHovered();
			if (activated)
			{
				g_selected_task_node_id = node->task_id;
				g_selected_task_node_line_id = node->task_line_id;
			}
			if (hovered && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left) &&
				!node->held && !gm_submission_running())
				submit_add_task(runtime, *node);
			if (hovered)
			{
				ImGui::BeginTooltip();
				ImGui::PushTextWrapPos(ImGui::GetFontSize() * 28.0f);
				ImGui::Text("[%lld] %s",
					static_cast<long long>(node->task_id),
					node->name.empty() ? "未命名节点" : node->name.c_str());
				if (!node->description.empty())
					ImGui::TextWrapped("%s", node->description.c_str());
				if (node->parent_task_id > 0)
					ImGui::TextDisabled("上游节点 %lld",
						static_cast<long long>(node->parent_task_id));
				if (node->status_inferred)
					ImGui::TextDisabled("状态由本地任务表与当前持有节点推断");
				ImGui::TextDisabled(node->held
					? "当前已持有，不重复添加"
					: "双击直接添加到当前角色");
				ImGui::PopTextWrapPos();
				ImGui::EndTooltip();
			}

			ImGui::TableNextColumn();
			const bool disabled = node->held || gm_submission_running();
			if (disabled)
				ImGui::BeginDisabled();
			if (ImGui::SmallButton("添加"))
				submit_add_task(runtime, *node);
			if (disabled)
				ImGui::EndDisabled();
			ImGui::PopID();
		}
		ImGui::EndTable();
	}

	void draw_task_inspector(
		reshade::api::effect_runtime *runtime,
		const snapshot &data,
		float height)
	{
		heading_text("任务详情", color_text);
		ImGui::Separator();
		if (ImGui::BeginChild("task-inspector", ImVec2(0.0f, height), ImGuiChildFlags_None))
		{
			const auto found = std::find_if(data.tasks.begin(), data.tasks.end(), task_selected);
			const seria_qa::task_record *selected = found == data.tasks.end() ? nullptr : &*found;
			if (selected == nullptr)
				selected = primary_task(data);
			if (selected == nullptr && !data.tasks.empty())
				selected = &data.tasks.front();
			if (selected == nullptr)
			{
				ImGui::TextDisabled("没有可检查的任务节点。");
			}
			else
			{
				select_task(*selected);
				ImGui::TextWrapped("[%lld] %s", static_cast<long long>(selected->task_id), selected->name.c_str());
				if (ImGui::SmallButton("复制任务 ID"))
					copy_task_id(selected->task_id);
				ImGui::SameLine();
				if (ImGui::SmallButton("复制编号与名称"))
				{
					const std::string text = std::to_string(selected->task_id) + " " + selected->name;
					ImGui::SetClipboardText(text.c_str());
					g_copied_until = GetTickCount64() + 2000;
				}
				ImGui::TextWrapped("%s", selected->description.empty() ? "无任务描述" : selected->description.c_str());
				ImGui::Separator();
				const task_progress_presentation progress =
					present_task_progress(data, *selected);
				ImGui::TextWrapped("状态：%s (%d)", status_name(selected->status), selected->status);
				ImGui::TextWrapped("完成度：%s",
					progress.known ? progress.text.c_str() : "--");
				ImGui::TextWrapped("任务线：%lld", static_cast<long long>(selected->task_line_id));
				if (data.focus.task_id == selected->task_id && primary_task(data) == selected)
				{
					ImGui::TextWrapped("焦点来源：%s", focus_source_name(data.focus.source));
					ImGui::SeparatorText("任务线进度");
					draw_progress_ring(data.focus, 88.0f, "inspector-progress");
					ImGui::SameLine(0.0f, 12.0f);
					ImGui::BeginGroup();
					if (data.focus.progress_known)
					{
						ImGui::Text("%d%%", progress_percent(data.focus));
						ImGui::TextWrapped("已完成：%d / %d 个配置节点",
							data.focus.completed_nodes, data.focus.total_nodes);
						ImGui::TextWrapped("当前：第 %d 个节点", data.focus.completed_nodes + 1);
						ImGui::TextWrapped("后续：%d 个节点", data.focus.remaining_nodes);
					}
					else
					{
						ImGui::TextDisabled("当前任务线无法定位起始节点");
						ImGui::TextWrapped("后续：%d 个配置节点", data.focus.remaining_nodes);
					}
					ImGui::EndGroup();
				}
				draw_task_nodes(runtime, data, *selected);
				ImGui::SeparatorText("配置后续候选");
				bool has_next = false;
				for (const auto &next : data.next)
				{
					if (next.parent_task_id != selected->task_id) continue;
					has_next = true;
					ImGui::TextWrapped("[%lld] %s%s", static_cast<long long>(next.task_id),
						next.name.c_str(), next.selected ? "" : "（分支未选）");
				}
				if (!has_next) ImGui::TextDisabled("没有配置后续候选");
				if (ImGui::CollapsingHeader("技术信息"))
				{
					ImGui::TextWrapped("类型：class %d / mission %d", selected->task_class, selected->mission_type);
					ImGui::TextWrapped("来源：%s%s", selected->client ? "客户端" : "服务端",
						selected->subtask ? " / 子任务" : "");
					ImGui::TextWrapped("运行态：%s%s%s", selected->active ? "激活 " : "",
						selected->traced ? "已追踪 " : "", selected->shown ? "任务栏显示" : "");
					ImGui::TextWrapped("数值：%lld", static_cast<long long>(selected->value));
				}
			}
		}
		ImGui::EndChild();
	}

	void draw_events(const snapshot &data, float height)
	{
		heading_text("问题与最近变化", color_text);
		ImGui::Separator();
		if (ImGui::BeginChild("event-history", ImVec2(0.0f, height), ImGuiChildFlags_None))
		{
			if (data.events.empty())
				ImGui::TextDisabled("本次会话还没有任务变化。");
			for (auto iterator = data.events.rbegin(); iterator != data.events.rend(); ++iterator)
			{
				ImGui::TextColored(event_color(*iterator), "~");
				ImGui::SameLine(0.0f, 6.0f);
				ImGui::Text("%s", event_name(iterator->kind));
				ImGui::SameLine(118.0f);
				if (iterator->task_id > 0)
					ImGui::Text("task %lld  %s", static_cast<long long>(iterator->task_id), iterator->label.c_str());
				else if (iterator->task_line_id > 0)
					ImGui::Text("line %lld", static_cast<long long>(iterator->task_line_id));
				else
					ImGui::TextDisabled("-");
			}
		}
		ImGui::EndChild();
	}

	void draw_dlss(float height)
	{
		const ImVec4 health_color = g_dlss.health == health_level::check
			? color_red
			: g_dlss.health == health_level::active ? color_cyan : color_yellow;
		heading_text("DLSS5 健康度", color_text);
		ImGui::SameLine();
		ImGui::TextColored(health_color, "%s",
			g_dlss.health == health_level::active ? "ACTIVE" :
				g_dlss.health == health_level::ready ? "READY" : "CHECK");
		ImGui::Separator();

		if (ImGui::BeginChild("dlss-health", ImVec2(0.0f, height), ImGuiChildFlags_None))
		{
			ImGui::Text("Runtime        %s", g_dlss.runtime_api.c_str());
			ImGui::Text("Bridge         %s / %s", g_dlss.bridge_installed ? "installed" : "missing",
				g_dlss.bridge_loaded ? "loaded" : "not loaded");
			ImGui::Text("RenoDX         %s / %s", g_dlss.renodx_installed ? "installed" : "missing",
				g_dlss.renodx_loaded ? "loaded" : "not loaded");
			ImGui::Text("NeuralUplift   %s", g_dlss.neural_uplift.c_str());
			ImGui::Text("NR preset      %s / style %s", g_dlss.nr_preset.c_str(), g_dlss.nr_style.c_str());
			ImGui::Text("Bridge mode    stage=%d mode=%d skip_exe=%d",
				g_dlss.stage, g_dlss.mode, g_dlss.skip_exe);
			ImGui::Text("Resolution     %dx%d", g_dlss.resolution_x, g_dlss.resolution_y);

			if (!g_dlss.issues.empty())
			{
				ImGui::SeparatorText("待处理");
				for (const health_issue &issue : g_dlss.issues)
				{
					text_status("!", color_red, "%s", issue.problem.c_str());
					ImGui::TextWrapped("  %s", issue.action.c_str());
				}
			}

			ImGui::SeparatorText("运行证据");
			ImGui::TextWrapped("%s", g_dlss.bridge_evidence.c_str());
			ImGui::TextWrapped("%s", g_dlss.renodx_evidence.c_str());
		}
		ImGui::EndChild();
	}

	bool gm_command_parameters_valid(const gm_command_definition &definition)
	{
		switch (definition.parameters)
		{
		case gm_parameter_kind::task_id:
			return g_mission_dialog_task_id > 0;
		case gm_parameter_kind::node_task_id:
			return g_selected_task_node_id > 0;
		case gm_parameter_kind::buff:
			return g_buff_id > 0 && g_buff_stacks >= 1 && g_buff_stacks <= 999;
		default:
			return true;
		}
	}

	void draw_gm_command_group(
		reshade::api::effect_runtime *runtime,
		gm_command_category category,
		const char *table_id)
	{
		if (!ImGui::BeginTable(table_id, 2,
			ImGuiTableFlags_SizingStretchProp | ImGuiTableFlags_BordersInnerH))
			return;

		const float action_width = std::min(
			ImGui::GetFontSize() * 13.0f,
			std::max(ImGui::GetFontSize() * 9.0f,
				ImGui::GetContentRegionAvail().x * 0.42f));
		ImGui::TableSetupColumn(
			"操作", ImGuiTableColumnFlags_WidthFixed, action_width);
		ImGui::TableSetupColumn("说明", ImGuiTableColumnFlags_WidthStretch);
		for (const gm_command_definition &definition : gm_command_definitions)
		{
			if (definition.category != category)
				continue;

			const bool parameter_invalid = !gm_command_parameters_valid(definition);
			const bool disabled = gm_submission_running() || parameter_invalid;
			ImGui::PushID(definition.command);
			ImGui::TableNextRow();
			ImGui::TableNextColumn();
			if (disabled)
				ImGui::BeginDisabled();
			if (definition.destructive)
			{
				ImGui::PushStyleColor(
					ImGuiCol_Button, ImVec4(0.36f, 0.14f, 0.14f, 1.0f));
				ImGui::PushStyleColor(
					ImGuiCol_ButtonHovered, ImVec4(0.48f, 0.18f, 0.18f, 1.0f));
				ImGui::PushStyleColor(
					ImGuiCol_ButtonActive, ImVec4(0.56f, 0.20f, 0.20f, 1.0f));
			}
			if (ImGui::Button(
				definition.action,
				ImVec2(ImGui::GetContentRegionAvail().x, 0.0f)))
			{
				const int64_t first_argument =
					definition.parameters == gm_parameter_kind::task_id
						? g_mission_dialog_task_id
						: definition.parameters == gm_parameter_kind::node_task_id
							? g_selected_task_node_id
						: definition.parameters == gm_parameter_kind::buff
							? g_buff_id
							: 0;
				const int64_t second_argument =
					definition.parameters == gm_parameter_kind::buff
						? g_buff_stacks
						: 0;
				begin_whitelisted_gm_submission(
					runtime,
					definition.id,
					first_argument,
					second_argument);
			}
			if (definition.destructive)
				ImGui::PopStyleColor(3);
			if (disabled)
				ImGui::EndDisabled();

			ImGui::TableNextColumn();
			ImGui::TextWrapped("%s", definition.description);
			ImGui::TextDisabled("%s  ·  %s", definition.command, definition.source);
			ImGui::PopID();
		}
		ImGui::EndTable();
	}

	void draw_gm_tools(reshade::api::effect_runtime *runtime)
	{
		ImGui::TextWrapped(
			"仅提供已审核的固定白名单。点击后工具会暂时关闭，自动打开游戏 GM "
			"面板并提交；诊断与状态操作分区展示，不提供自由文本。");

		if (gm_submission_running())
		{
			text_status_wrapped("~", color_yellow, "正在提交：%s",
				g_pending_gm_label.c_str());
		}
		else if (g_gm_submission == gm_submission_phase::failed)
		{
			text_status_wrapped("!", color_red, "提交失败：%s",
				g_gm_submission_error.c_str());
		}
		else if (g_has_last_gm_submission)
		{
			const ImVec4 color =
				g_last_gm_submission_succeeded ? color_cyan : color_red;
			text_status_wrapped(
				g_last_gm_submission_succeeded ? "+" : "!",
				color,
				"%s：%s  ·  %s",
				g_last_gm_submission_succeeded ? "已提交" : "提交失败",
				g_last_gm_label.c_str(),
				g_last_gm_message.c_str());
			ImGui::TextDisabled("%s", g_last_gm_command.c_str());
		}

		ImGui::SeparatorText("任务诊断");
		if (g_mission_dialog_task_id <= 0)
		{
			if (g_selected_task_id > 0)
				g_mission_dialog_task_id = g_selected_task_id;
			else if (g_snapshots.current)
			{
				const seria_qa::task_record *const current =
					primary_task(*g_snapshots.current);
				if (current != nullptr)
					g_mission_dialog_task_id = current->task_id;
			}
		}
		ImGui::SetNextItemWidth(std::min(
			ImGui::GetFontSize() * 14.0f,
			ImGui::GetContentRegionAvail().x * 0.45f));
		if (ImGui::InputScalar(
			"起始任务 ID",
			ImGuiDataType_S64,
			&g_mission_dialog_task_id))
		{
			g_mission_dialog_task_id =
				std::max<int64_t>(0, g_mission_dialog_task_id);
		}
		if (g_selected_task_id > 0)
		{
			ImGui::SameLine();
			if (ImGui::Button("使用已选任务"))
				g_mission_dialog_task_id = g_selected_task_id;
		}
		if (g_mission_dialog_task_id <= 0)
			ImGui::TextColored(color_yellow,
				"“评估任务线对白”需要一个有效的起始任务 ID。");
		draw_gm_command_group(
			runtime, gm_command_category::task, "gm-task-commands");

		ImGui::SeparatorText("位置与场景");
		draw_gm_command_group(
			runtime, gm_command_category::location, "gm-location-commands");

		ImGui::SeparatorText("状态操作");
		ImGui::TextColored(
			color_yellow,
			"以下操作会改变任务、动画、角色或战斗场景状态，仅用于开发和测试环境。");
		ImGui::SetNextItemWidth(std::min(
			ImGui::GetFontSize() * 12.0f,
			ImGui::GetContentRegionAvail().x * 0.45f));
		if (ImGui::InputScalar(
			"添加任务 ID",
			ImGuiDataType_S64,
			&g_selected_task_node_id))
		{
			g_selected_task_node_id =
				std::max<int64_t>(0, g_selected_task_node_id);
		}
		if (g_selected_task_node_id <= 0)
			ImGui::TextColored(color_yellow,
				"“添加任务”需要有效的任务节点 ID。");

		const bool buff_inputs_inline =
			ImGui::GetContentRegionAvail().x >= ImGui::GetFontSize() * 31.0f;
		ImGui::SetNextItemWidth(std::min(
			ImGui::GetFontSize() * 12.0f,
			ImGui::GetContentRegionAvail().x *
				(buff_inputs_inline ? 0.36f : 0.70f)));
		if (ImGui::InputScalar("Buff ID", ImGuiDataType_S64, &g_buff_id))
			g_buff_id = std::max<int64_t>(0, g_buff_id);
		if (buff_inputs_inline)
			ImGui::SameLine();
		ImGui::SetNextItemWidth(std::min(
			ImGui::GetFontSize() * 8.0f,
			ImGui::GetContentRegionAvail().x *
				(buff_inputs_inline ? 0.28f : 0.55f)));
		if (ImGui::InputInt("层数", &g_buff_stacks))
			g_buff_stacks = std::clamp(g_buff_stacks, 1, 999);
		if (g_buff_id <= 0)
			ImGui::TextColored(color_yellow,
				"“为自己添加 Buff”需要有效的 Buff ID；层数范围为 1-999。");
		draw_gm_command_group(
			runtime, gm_command_category::action, "gm-state-commands");

		ImGui::SeparatorText("结果位置");
		ImGui::TextDisabled(
			"屏幕/聊天类结果直接显示在游戏内；日志类结果写入 Saved\\Logs。");
	}

	void draw_details_content(reshade::api::effect_runtime *runtime)
	{
		heading_text("角色任务", color_text, 1.10f);
		ImGui::SameLine();
		ImGui::TextDisabled("任务数据只读  ·  %s", !g_snapshots.current ? "未连接" :
			g_snapshots.is_live() ? "实时" : "数据暂停");
		if (g_snapshots.current && !g_snapshots.is_live())
			text_wrapped_colored(color_yellow, "显示上次有效数据。确认客户端仍在运行且 Saved 目录可写。");
		if (g_snapshots.current && g_snapshots.current->dialogue.active)
			draw_active_dialogue(g_snapshots.current->dialogue, true);
		if (ImGui::BeginTabBar("qa-pages"))
		{
			if (ImGui::BeginTabItem("全部任务"))
			{
				if (!g_snapshots.current)
				{
					ImGui::TextWrapped("进入角色后，可由工具自动打开 GM 面板并启动任务采集。");
					const bool activation_running =
						gm_submission_running() && g_pending_gm_is_capture;
					if (activation_running)
						ImGui::BeginDisabled();
					if (ImGui::Button(activation_running ? "正在启动..." : "一键启动采集"))
						begin_capture_activation(runtime);
					if (activation_running)
						ImGui::EndDisabled();
					if (g_gm_submission == gm_submission_phase::failed &&
						g_pending_gm_is_capture)
						text_wrapped_colored(
							color_red, "%s", g_gm_submission_error.c_str());
					ImGui::SeparatorText("手动备用");
					if (ImGui::Button("复制启动命令"))
					{
						ImGui::SetClipboardText(capture_external_gm_command);
						g_copied_until = GetTickCount64() + 2000;
					}
					if (GetTickCount64() < g_copied_until) ImGui::TextDisabled("已复制");
					ImGui::TextWrapped("%s", capture_external_gm_command);
				}
				else
				{
					const snapshot &data = *g_snapshots.current;
					ImGui::TextDisabled("服务端 %d  ·  客户端 %d  ·  包含隐藏任务及子任务",
						data.server_task_count, data.client_task_count);
					const float area_height = std::max(220.0f, ImGui::GetContentRegionAvail().y - 8);
					if (ImGui::GetContentRegionAvail().x >= ImGui::GetFontSize() * 48)
					{
						if (ImGui::BeginTable("task-browser", 2,
							ImGuiTableFlags_Resizable | ImGuiTableFlags_SizingStretchProp))
						{
							ImGui::TableSetupColumn("任务", ImGuiTableColumnFlags_WidthStretch, 2.0f);
							ImGui::TableSetupColumn("详情", ImGuiTableColumnFlags_WidthStretch, 1.0f);
							ImGui::TableNextColumn();
							draw_task_outline(data, area_height);
							ImGui::TableNextColumn();
							draw_task_inspector(
								runtime, data,
								area_height - ImGui::GetFrameHeightWithSpacing());
							ImGui::EndTable();
						}
					}
					else
					{
						draw_task_outline(data, std::max(220.0f, area_height * 0.58f));
						draw_task_inspector(
							runtime, data,
							std::max(140.0f, area_height * 0.34f));
					}
				}
				ImGui::EndTabItem();
			}
			if (ImGui::BeginTabItem("最近变化"))
			{
				if (g_snapshots.current)
					draw_events(*g_snapshots.current, std::max(100.0f, ImGui::GetContentRegionAvail().y - 40));
				else ImGui::TextDisabled("启动任务采集后显示变化记录。");
				ImGui::EndTabItem();
			}
			if (ImGui::BeginTabItem("GM 工具"))
			{
				draw_gm_tools(runtime);
				ImGui::EndTabItem();
			}
			if (g_dlss.available &&
				ImGui::BeginTabItem(g_dlss.health == health_level::check
					? "画面诊断 !###graphics"
					: "画面诊断###graphics"))
			{
				draw_dlss(std::max(100.0f, ImGui::GetContentRegionAvail().y - 40));
				ImGui::EndTabItem();
			}
			if (ImGui::BeginTabItem("显示设置"))
			{
				if (ImGui::Checkbox("显示左上角任务窗口", &g_hud_visible))
					reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudVisible", g_hud_visible);
				if (ImGui::Checkbox(
					"Home 显示完整 ReShade 页面", &g_home_opens_full_reshade))
				{
					reshade::set_config_value(
						nullptr,
						"SeriaQAOverlay",
						"HomeOpensFullReShade",
						g_home_opens_full_reshade);
				}
				if (ImGui::IsItemHovered())
					ImGui::SetTooltip(
						"关闭时 Home 只打开任务 QA；开启后显示完整 ReShade 页面。");
				ImGui::SetNextItemWidth(std::min(260.0f, ImGui::GetContentRegionAvail().x * 0.55f));
				if (ImGui::SliderInt("背景不透明度", &g_hud_opacity_percent, 25, 100, "%d%%"))
					reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudOpacity", g_hud_opacity_percent);
				ImGui::TextWrapped("数值越低，背景越透明。");
				if (ImGui::CollapsingHeader("采集信息"))
				{
					ImGui::Text("插件 %s · 快照协议 v6", addon_version);
					if (g_snapshots.current)
					{
						const snapshot &data = *g_snapshots.current;
						ImGui::Text("快照 %llu", static_cast<unsigned long long>(data.sequence));
						ImGui::TextWrapped("更新原因：%s", data.reasons.c_str());
						ImGui::TextWrapped("导航任务 %lld · 地图 %lld · 目标 %d:%lld",
							static_cast<long long>(data.navigation.task_id), static_cast<long long>(data.navigation.map_id),
							data.navigation.target_type, static_cast<long long>(data.navigation.target_id));
						ImGui::TextWrapped("%s · 开始 ID %lld · 当前句 ID %lld · 任务 %lld",
							dialogue_type_name(data.dialogue),
							static_cast<long long>(data.dialogue.start_id),
							static_cast<long long>(data.dialogue.current_id),
							static_cast<long long>(data.dialogue.task_id));
					}
					ImGui::TextWrapped("读取信息：%s", g_snapshots.error.empty() ? "正常" : g_snapshots.error.c_str());
				}
				ImGui::EndTabItem();
			}
			ImGui::EndTabBar();
		}
	}

	void draw_details(reshade::api::effect_runtime *runtime)
	{
		initialize_runtime_state(runtime);
		g_snapshots.poll();
		if (g_snapshots.current)
			update_task_changes(*g_snapshots.current);
		refresh_dlss_diagnostics(runtime);
		push_overlay_style();
		draw_details_content(runtime);
		pop_overlay_style();
	}

	void draw_task_workspace(reshade::api::effect_runtime *runtime)
	{
		if (!g_task_workspace_open)
			return;

		runtime->block_input_next_frame();
		ImGui::SetNextFrameWantCaptureKeyboard(true);
		ImGui::SetNextFrameWantCaptureMouse(true);
		ImGui::GetIO().MouseDrawCursor = true;
		g_workspace_cursor_owned = true;

		const ImVec2 display = ImGui::GetIO().DisplaySize;
		const ImVec2 window_size(
			std::min(std::max(720.0f, display.x * 0.82f), std::max(320.0f, display.x - 24.0f)),
			std::min(std::max(520.0f, display.y * 0.82f), std::max(240.0f, display.y - 24.0f)));
		ImGui::SetNextWindowSize(window_size, ImGuiCond_FirstUseEver);
		ImGui::SetNextWindowPos(
			ImVec2((display.x - window_size.x) * 0.5f, (display.y - window_size.y) * 0.5f),
			ImGuiCond_FirstUseEver);
		if (g_task_workspace_focus_requested)
		{
			ImGui::SetNextWindowFocus();
			g_task_workspace_focus_requested = false;
		}

		push_overlay_style();
		bool open = g_task_workspace_open;
		const ImGuiWindowFlags flags =
			ImGuiWindowFlags_NoCollapse |
			ImGuiWindowFlags_NoSavedSettings;
		if (ImGui::Begin("任务 QA###seria-qa-workspace", &open, flags))
			draw_details_content(runtime);
		ImGui::End();
		pop_overlay_style();
		g_task_workspace_open = open;
	}

	void draw_overlay(reshade::api::effect_runtime *runtime)
	{
		if (!g_task_workspace_open && g_workspace_cursor_owned)
		{
			ImGui::GetIO().MouseDrawCursor = false;
			g_workspace_cursor_owned = false;
		}
		draw_hud(runtime);
		draw_task_workspace(runtime);
	}

	void set_hud_visibility(bool visible)
	{
		g_hud_visible = visible;
		reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudVisible", visible);
	}

	bool on_open_overlay(reshade::api::effect_runtime *runtime, bool open, reshade::api::input_source source)
	{
		initialize_runtime_state(runtime);
		refresh_dlss_diagnostics(runtime);
		const bool chord_down = runtime->is_key_down(VK_HOME) && runtime->is_key_down(VK_CONTROL);
		if (source == reshade::api::input_source::keyboard && chord_down)
		{
			if (!g_toggle_chord_down)
				set_hud_visibility(!g_hud_visible);
			g_toggle_chord_down = true;
			return true;
		}
		const bool shift_down = runtime->is_key_down(VK_SHIFT);
		if (source == reshade::api::input_source::keyboard && open &&
			!shift_down && !g_home_opens_full_reshade)
		{
			g_task_workspace_open = !g_task_workspace_open;
			g_task_workspace_focus_requested = g_task_workspace_open;
			if (g_task_workspace_open)
			{
				g_task_interaction_hint_pending = true;
				g_task_interaction_hint_id = 0;
			}
			g_overlay_open = false;
			return true;
		}
		if (open)
		{
			g_task_workspace_open = false;
			g_task_interaction_hint_pending = true;
			g_task_interaction_hint_id = 0;
		}
		g_overlay_open = open;
		return false;
	}

	bool is_seria_process()
	{
		wchar_t path[MAX_PATH] = {};
		if (GetModuleFileNameW(nullptr, path, static_cast<DWORD>(std::size(path))) == 0)
			return false;
		const wchar_t *name = wcsrchr(path, L'\\');
		name = name == nullptr ? path : name + 1;
		return _wcsicmp(name, L"Seria.exe") == 0;
	}
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID)
{
	if (reason == DLL_PROCESS_ATTACH)
	{
		g_module = module;
		DisableThreadLibraryCalls(module);
		if (!reshade::register_addon(module))
			return FALSE;
		g_registered = true;

		if (!is_seria_process())
			return TRUE;

		reshade::register_event<reshade::addon_event::reshade_overlay>(draw_overlay);
		reshade::register_event<reshade::addon_event::reshade_open_overlay>(on_open_overlay);
		reshade::register_overlay("Seria QA", draw_details);
		g_ui_registered = true;
	}
	else if (reason == DLL_PROCESS_DETACH && g_registered)
	{
		if (g_ui_registered)
		{
			reshade::unregister_overlay("Seria QA", draw_details);
			reshade::unregister_event<reshade::addon_event::reshade_open_overlay>(on_open_overlay);
			reshade::unregister_event<reshade::addon_event::reshade_overlay>(draw_overlay);
			g_ui_registered = false;
		}
		reshade::unregister_addon(module);
		g_registered = false;
	}
	return TRUE;
}
