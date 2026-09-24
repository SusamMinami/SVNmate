#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace seria_qa
{
	struct task_record
	{
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		int status = 0;
		int task_class = 0;
		int mission_type = 0;
		int64_t value = 0;
		bool active = false;
		bool traced = false;
		bool shown = false;
		bool client = false;
		bool subtask = false;
		bool parallel = false;
		bool auto_next = false;
		std::string name;
		std::string description;
	};

	struct next_record
	{
		int64_t parent_task_id = 0;
		int index = 0;
		bool selected = false;
		int64_t task_id = 0;
		std::string name;
	};

	struct trace_record
	{
		int main_type = 0;
		int64_t task_line_id = 0;
	};

	struct navigation_record
	{
		bool guide_active = false;
		bool auto_moving = false;
		int64_t task_id = 0;
		int64_t map_id = 0;
		int target_type = 0;
		int64_t target_id = 0;
	};

	struct dialogue_record
	{
		bool active = false;
		int64_t start_id = 0;
		int64_t current_id = 0;
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		bool complex_chat = false;
		bool camera_dialog = false;
	};

	struct focus_record
	{
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		int completed_nodes = 0;
		int remaining_nodes = 0;
		int total_nodes = 0;
		bool has_branches = false;
		bool progress_known = false;
		std::string source;
	};

	// Per-task structural progress, one record per unique held task id.
	struct progress_record
	{
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		int completed_nodes = 0;
		int remaining_nodes = 0;
		int total_nodes = 0;
		bool has_branches = false;
		bool progress_known = false;
	};

	struct task_node_record
	{
		int64_t task_line_id = 0;
		int64_t task_id = 0;
		int64_t parent_task_id = 0;
		int depth = 0;
		int order = 0;
		int status = 0;
		bool held = false;
		bool selected_path = false;
		bool branch = false;
		bool status_inferred = false;
		bool subtask_edge = false;
		std::string name;
		std::string description;
	};

	struct event_record
	{
		uint64_t sequence = 0;
		int64_t time_ms = 0;
		std::string kind;
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		int status = 0;
		std::string label;
	};

	struct snapshot
	{
		uint32_t schema_version = 0;
		uint64_t sequence = 0;
		int64_t generated_at_ms = 0;
		std::string reasons;
		bool task_list_ready = false;
		int server_task_count = 0;
		int client_task_count = 0;
		bool task_nodes_truncated = false;
		std::vector<task_record> tasks;
		std::vector<next_record> next;
		std::vector<trace_record> traces;
		navigation_record navigation;
		dialogue_record dialogue;
		focus_record focus;
		std::vector<progress_record> progress;
		std::vector<task_node_record> task_nodes;
		std::vector<event_record> events;
	};

	struct parse_result
	{
		bool valid = false;
		snapshot value;
		std::string error;
	};

	parse_result parse_snapshot(std::string_view text);
}
