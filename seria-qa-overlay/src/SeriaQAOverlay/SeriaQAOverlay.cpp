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
	"Read-only task flow, navigation, dialogue, and optional DLSS5 diagnostics for Seria.";

namespace
{
	using seria_qa::snapshot;

	constexpr char addon_version[] = "0.3.0";
	constexpr ULONGLONG snapshot_poll_interval_ms = 100;
	constexpr ULONGLONG diagnostics_poll_interval_ms = 1000;
	constexpr size_t max_file_bytes = 512 * 1024;
	constexpr char gm_dialog_command[] =
		"RunLuaString dofile(UE4.USeriaLuaInterface.GetProjectBinariesDirectory()..\"/SeriaQA.lua\")";
	constexpr char external_gm_command[] =
		"gm:RunLuaString dofile(UE4.USeriaLuaInterface.GetProjectBinariesDirectory()..\"/SeriaQA.lua\")";

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
	bool g_toggle_chord_down = false;
	int g_hud_opacity_percent = 78;
	int64_t g_selected_task_id = 0;
	bool g_selected_task_client = false;
	int g_task_filter = 0;
	char g_task_search[192] = {};
	bool g_scroll_to_selected = false;
	ULONGLONG g_copied_until = 0;
	std::filesystem::path g_module_dir;
	FILETIME g_process_start_time = {};

	enum class capture_activation_phase
	{
		idle,
		open_gm,
		paste,
		submit,
		waiting,
		failed,
	};

	capture_activation_phase g_capture_activation = capture_activation_phase::idle;
	ULONGLONG g_capture_activation_due = 0;
	std::string g_capture_activation_error;

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

	void fail_capture_activation(const char *message)
	{
		g_capture_activation = capture_activation_phase::failed;
		g_capture_activation_error = message;
	}

	void begin_capture_activation(reshade::api::effect_runtime *runtime)
	{
		ImGui::SetClipboardText(gm_dialog_command);
		g_capture_activation = capture_activation_phase::open_gm;
		g_capture_activation_due = GetTickCount64() + 250;
		g_capture_activation_error.clear();
		if (!runtime->open_overlay(false, reshade::api::input_source::none))
			fail_capture_activation("无法关闭 ReShade，请关闭工具页后重试。");
	}

	void update_capture_activation(bool capture_live)
	{
		if (capture_live)
		{
			g_capture_activation = capture_activation_phase::idle;
			g_capture_activation_error.clear();
			return;
		}
		if (g_capture_activation == capture_activation_phase::idle ||
			g_capture_activation == capture_activation_phase::failed)
			return;

		const ULONGLONG now = GetTickCount64();
		if (now < g_capture_activation_due)
			return;
		if (!foreground_window_belongs_to_process())
		{
			fail_capture_activation("游戏窗口不在前台，请切回游戏后重试。");
			return;
		}

		switch (g_capture_activation)
		{
		case capture_activation_phase::open_gm:
			if (!send_key(VK_OEM_5))
			{
				fail_capture_activation("无法打开 GM 输入框。");
				return;
			}
			g_capture_activation = capture_activation_phase::paste;
			g_capture_activation_due = now + 350;
			break;
		case capture_activation_phase::paste:
			if (!paste_clipboard())
			{
				fail_capture_activation("无法粘贴启动命令。");
				return;
			}
			g_capture_activation = capture_activation_phase::submit;
			g_capture_activation_due = now + 150;
			break;
		case capture_activation_phase::submit:
			if (!send_key(VK_RETURN))
			{
				fail_capture_activation("无法提交启动命令。");
				return;
			}
			g_capture_activation = capture_activation_phase::waiting;
			g_capture_activation_due = now + 8000;
			break;
		case capture_activation_phase::waiting:
			fail_capture_activation("未收到任务数据。请确认已进入角色，或复制命令手动执行。");
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
				return nullptr; // Schema v2 does not qualify any focus source by origin.
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

	ImVec4 event_color(const seria_qa::event_record &event)
	{
		if (event.kind == "failed" || event.kind == "abandon")
			return color_red;
		return color_muted;
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

	size_t completed_task_count(const snapshot &data)
	{
		return static_cast<size_t>(std::count_if(data.tasks.begin(), data.tasks.end(),
			[](const seria_qa::task_record &task) { return task.status == 2 || task.status == 3; }));
	}

	bool is_completion_event(const seria_qa::event_record &event)
	{
		return event.task_id > 0 && (event.kind == "finished" || event.kind == "committed");
	}

	void draw_recent_completions(const snapshot &data)
	{
		std::array<int64_t, 2> shown_task_ids = {};
		int shown = 0;
		for (auto iterator = data.events.rbegin(); iterator != data.events.rend() && shown < 2; ++iterator)
		{
			if (!is_completion_event(*iterator) ||
				std::find(shown_task_ids.begin(), shown_task_ids.end(), iterator->task_id) != shown_task_ids.end())
				continue;
			if (shown == 0)
				ImGui::Separator();
			shown_task_ids[static_cast<size_t>(shown)] = iterator->task_id;
			ImGui::TextColored(color_muted, "v");
			ImGui::SameLine(0.0f, 6.0f);
			ImGui::TextWrapped("%s [%lld] %s",
				shown == 0 ? "上次完成" : "上上次完成",
				static_cast<long long>(iterator->task_id),
				iterator->label.empty() ? "(unnamed task)" : iterator->label.c_str());
			++shown;
		}
	}

	void draw_hud_task(const seria_qa::task_record &task)
	{
		ImGui::TextColored(status_color(task.status), "%s", status_marker(task.status));
		ImGui::SameLine(0.0f, 6.0f);
		const std::string name = shortened(task.name.empty() ? "(unnamed task)" : task.name, 88);
		ImGui::Text("[%lld] %s", static_cast<long long>(task.task_id), name.c_str());
		if (!task.description.empty())
			ImGui::TextWrapped("  %s", task.description.c_str());
		ImGui::TextColored(color_muted, "  %s", status_name(task.status));
	}

	void draw_hud(reshade::api::effect_runtime *runtime)
	{
		initialize_runtime_state(runtime);
		g_snapshots.poll();
		update_capture_activation(g_snapshots.is_live());

		const bool chord_down = runtime->is_key_down(VK_HOME) && runtime->is_key_down(VK_CONTROL);
		if (chord_down && !g_toggle_chord_down)
		{
			g_hud_visible = !g_hud_visible;
			reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudVisible", g_hud_visible);
		}
		g_toggle_chord_down = chord_down;
		if (!g_hud_visible || g_overlay_open)
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
				if (g_capture_activation == capture_activation_phase::failed)
					ImGui::TextWrapped("%s", g_capture_activation_error.c_str());
				else if (g_capture_activation != capture_activation_phase::idle)
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
				const seria_qa::task_record *const task = primary_task(data);
				if (task != nullptr)
				{
					draw_hud_task(*task);
					if (data.focus.task_id == task->task_id)
						ImGui::TextColored(color_muted, "  任务线进度  后续 %d 个配置节点%s",
							data.focus.remaining_nodes, data.focus.has_branches ? "（含分支）" : "");
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
				if (data.dialogue.active)
					text_status("", color_muted, "对话 %lld  ·  节点 %lld",
						static_cast<long long>(data.dialogue.start_id),
						static_cast<long long>(data.dialogue.current_id));

				draw_recent_completions(data);
				ImGui::TextDisabled("Home 查看全部 %zu 条任务", data.tasks.size());
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
			text << "任务编号\t任务名称\t状态\t来源\n";
			for (const auto &task : data.tasks)
				if (task_visible_for_filter(task))
					text << task.task_id << '\t' << task.name << '\t' << status_name(task.status)
						<< '\t' << (task.client ? "客户端" : "服务端") << '\n';
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
			std::stable_sort(tasks.begin(), tasks.end(), [](const auto *a, const auto *b) {
				if (a->task_id != b->task_id) return a->task_id < b->task_id;
				return a->client < b->client;
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
					if (ImGui::Selectable("##task-tile", task_selected(task), 0, size)) select_task(task);
					if (g_scroll_to_selected && task_selected(task))
					{
						ImGui::SetScrollHereY(0.5f);
						g_scroll_to_selected = false;
					}
					const bool hovered = ImGui::IsItemHovered();
					ImDrawList *draw = ImGui::GetWindowDrawList();
					draw->PushClipRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), true);
					draw->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y),
						ImGui::GetColorU32(task_selected(task) ? color_cyan : ImVec4(0.30f, 0.30f, 0.32f, 1)), 4.0f);
					const ImU32 ink = ImGui::GetColorU32(color_muted);
					const float ix = pos.x + 10, iy = pos.y + 10;
					draw->AddRect(ImVec2(ix, iy), ImVec2(ix + 12, iy + 16), ink, 1);
					draw->AddLine(ImVec2(ix + 3, iy + 6), ImVec2(ix + 9, iy + 6), ink);
					draw->AddLine(ImVec2(ix + 3, iy + 10), ImVec2(ix + 9, iy + 10), ink);
					const std::string id = std::to_string(task.task_id) +
						(current && current->task_id == task.task_id && current->client == task.client ? "  当前" : "");
					draw->AddText(ImVec2(ix + 20, iy), ink, id.c_str());
					const std::string title = fit_text(task.name.empty() ? "未命名任务" : task.name, size.x - 20);
					draw->AddText(ImVec2(ix, iy + line + 3), ImGui::GetColorU32(color_text), title.c_str());
					const std::string meta = std::string(status_name(task.status)) +
						(task.client ? " · 客户端" : " · 服务端") + (task.subtask ? " · 子任务" : "") +
						(task.traced ? " · 已追踪" : "");
					draw->AddText(ImVec2(ix, iy + 2 * line + 6), ImGui::GetColorU32(status_color(task.status)),
						fit_text(meta, size.x - 20).c_str());
					draw->PopClipRect();
					if (hovered)
					{
						ImGui::BeginTooltip();
						ImGui::PushTextWrapPos(ImGui::GetFontSize() * 26);
						ImGui::Text("%lld", static_cast<long long>(task.task_id));
						ImGui::TextWrapped("%s", task.name.c_str());
						ImGui::TextWrapped("%s", task.description.c_str());
						ImGui::TextDisabled("点击查看详情，不改变游戏内追踪");
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
	}

	void draw_task_inspector(const snapshot &data, float height)
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
				if (ImGui::SmallButton("复制编号与名称"))
				{
					const std::string text = std::to_string(selected->task_id) + " " + selected->name;
					ImGui::SetClipboardText(text.c_str());
					g_copied_until = GetTickCount64() + 2000;
				}
				ImGui::TextWrapped("%s", selected->description.empty() ? "无任务描述" : selected->description.c_str());
				ImGui::Separator();
				ImGui::TextWrapped("状态：%s (%d)", status_name(selected->status), selected->status);
				ImGui::TextWrapped("任务线：%lld", static_cast<long long>(selected->task_line_id));
				if (data.focus.task_id == selected->task_id && primary_task(data) == selected)
				{
					ImGui::TextWrapped("焦点来源：%s", focus_source_name(data.focus.source));
					ImGui::TextWrapped("后续节点：%d%s", data.focus.remaining_nodes,
						data.focus.has_branches ? "（含分支）" : "");
				}
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

	void draw_details(reshade::api::effect_runtime *runtime)
	{
		initialize_runtime_state(runtime);
		g_snapshots.poll();
		refresh_dlss_diagnostics(runtime);
		push_overlay_style();

		heading_text("角色任务", color_text, 1.10f);
		ImGui::SameLine();
		ImGui::TextDisabled("只读  ·  %s", !g_snapshots.current ? "未连接" :
			g_snapshots.is_live() ? "实时" : "数据暂停");
		if (g_snapshots.current && !g_snapshots.is_live())
			text_wrapped_colored(color_yellow, "显示上次有效数据。确认客户端仍在运行且 Saved 目录可写。");
		if (ImGui::BeginTabBar("qa-pages"))
		{
			if (ImGui::BeginTabItem("全部任务"))
			{
				if (!g_snapshots.current)
				{
					ImGui::TextWrapped("进入角色后，可由工具自动打开 GM 面板并启动任务采集。");
					const bool activation_running =
						g_capture_activation != capture_activation_phase::idle &&
						g_capture_activation != capture_activation_phase::failed;
					if (activation_running)
						ImGui::BeginDisabled();
					if (ImGui::Button(activation_running ? "正在启动..." : "一键启动采集"))
						begin_capture_activation(runtime);
					if (activation_running)
						ImGui::EndDisabled();
					if (g_capture_activation == capture_activation_phase::failed)
						text_wrapped_colored(color_red, "%s", g_capture_activation_error.c_str());
					ImGui::SeparatorText("手动备用");
					if (ImGui::Button("复制启动命令"))
					{
						ImGui::SetClipboardText(external_gm_command);
						g_copied_until = GetTickCount64() + 2000;
					}
					if (GetTickCount64() < g_copied_until) ImGui::TextDisabled("已复制");
					ImGui::TextWrapped("%s", external_gm_command);
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
							draw_task_inspector(data, area_height - ImGui::GetFrameHeightWithSpacing());
							ImGui::EndTable();
						}
					}
					else
					{
						draw_task_outline(data, std::max(220.0f, area_height * 0.58f));
						draw_task_inspector(data, std::max(140.0f, area_height * 0.34f));
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
				ImGui::SetNextItemWidth(std::min(260.0f, ImGui::GetContentRegionAvail().x * 0.55f));
				if (ImGui::SliderInt("背景不透明度", &g_hud_opacity_percent, 25, 100, "%d%%"))
					reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudOpacity", g_hud_opacity_percent);
				ImGui::TextWrapped("数值越低，背景越透明。Home 关闭工具页后可查看效果；Ctrl+Home 切换任务窗口。");
				if (ImGui::CollapsingHeader("采集信息"))
				{
					ImGui::Text("插件 %s · 支持协议 v1 / v2", addon_version);
					if (g_snapshots.current)
					{
						const snapshot &data = *g_snapshots.current;
						ImGui::Text("快照 %llu", static_cast<unsigned long long>(data.sequence));
						ImGui::TextWrapped("更新原因：%s", data.reasons.c_str());
						ImGui::TextWrapped("导航任务 %lld · 地图 %lld · 目标 %d:%lld",
							static_cast<long long>(data.navigation.task_id), static_cast<long long>(data.navigation.map_id),
							data.navigation.target_type, static_cast<long long>(data.navigation.target_id));
						ImGui::TextWrapped("对话 %lld · 节点 %lld · 任务 %lld",
							static_cast<long long>(data.dialogue.start_id), static_cast<long long>(data.dialogue.current_id),
							static_cast<long long>(data.dialogue.task_id));
					}
					ImGui::TextWrapped("读取信息：%s", g_snapshots.error.empty() ? "正常" : g_snapshots.error.c_str());
				}
				ImGui::EndTabItem();
			}
			ImGui::EndTabBar();
		}

		pop_overlay_style();
	}

	void set_hud_visibility(bool visible)
	{
		g_hud_visible = visible;
		reshade::set_config_value(nullptr, "SeriaQAOverlay", "HudVisible", visible);
	}

	bool on_open_overlay(reshade::api::effect_runtime *runtime, bool open, reshade::api::input_source source)
	{
		initialize_runtime_state(runtime);
		const bool chord_down = runtime->is_key_down(VK_HOME) && runtime->is_key_down(VK_CONTROL);
		if (source == reshade::api::input_source::keyboard && chord_down)
		{
			if (!g_toggle_chord_down)
				set_hud_visibility(!g_hud_visible);
			g_toggle_chord_down = true;
			return true;
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

		reshade::register_event<reshade::addon_event::reshade_overlay>(draw_hud);
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
			reshade::unregister_event<reshade::addon_event::reshade_overlay>(draw_hud);
			g_ui_registered = false;
		}
		reshade::unregister_addon(module);
		g_registered = false;
	}
	return TRUE;
}
