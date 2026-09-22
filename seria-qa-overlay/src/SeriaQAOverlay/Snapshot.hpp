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
	};

	struct focus_record
	{
		int64_t task_id = 0;
		int64_t task_line_id = 0;
		int remaining_nodes = 0;
		bool has_branches = false;
		std::string source;
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
		std::vector<task_record> tasks;
		std::vector<next_record> next;
		std::vector<trace_record> traces;
		navigation_record navigation;
		dialogue_record dialogue;
		focus_record focus;
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
