#include "Snapshot.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace
{
	void require(bool condition, const char *message)
	{
		if (!condition)
		{
			std::cerr << "FAILED: " << message << '\n';
			std::exit(1);
		}
	}

	std::string encode_utf16le_ascii(std::string_view text)
	{
		std::string encoded("\xff\xfe", 2);
		encoded.reserve(2 + text.size() * 2);
		for (const unsigned char value : text)
		{
			encoded.push_back(static_cast<char>(value));
			encoded.push_back('\0');
		}
		return encoded;
	}
}

int main(int argc, char **argv)
{
	const std::string valid =
		"SERIA_QA_SNAPSHOT\t6\t42\t123456\taccept%2Crefresh\n"
		"META\t1\t1\t0\t0\n"
		"TASK\t100101\t1001\t1\t1\t2\t3\t1\t1\t1\t0\t0\t0\t0\tMain%09Task\tLine%0AOne\n"
		"NEXT\t100101\t1\t1\t100102\tNext%25Task\n"
		"TRACE\t1\t1001\n"
		"NAV\t1\t1\t100101\t2001\t2\t3001\n"
		"DIALOG\t1\t400100\t400103\t100101\t1001\t1\t0\n"
		"FOCUS\t100101\t1001\t2\t4\t7\t1\t1\tnavigation\n"
		"PROGRESS\t100101\t1001\t2\t4\t7\t1\t1\n"
		"NODE\t1001\t100100\t0\t0\t1\t2\t0\t1\t0\t1\t0\tPrevious\tDone\n"
		"EVENT\t7\t123450\taccepted\t100101\t1001\t1\tMain\n"
		"END\t42\t10\n";

	const seria_qa::parse_result parsed = seria_qa::parse_snapshot(valid);
	require(parsed.valid, parsed.error.c_str());
	require(parsed.value.sequence == 42, "sequence");
	require(parsed.value.task_list_ready, "task list readiness");
	require(parsed.value.tasks.size() == 1, "task count");
	require(parsed.value.tasks[0].name == "Main\tTask", "percent-decoded tab");
	require(parsed.value.tasks[0].description == "Line\nOne", "percent-decoded newline");
	require(parsed.value.next.size() == 1, "next count");
	require(parsed.value.next[0].name == "Next%Task", "percent-decoded percent");
	require(parsed.value.navigation.auto_moving, "navigation state");
	require(parsed.value.dialogue.current_id == 400103, "dialogue node");
	require(parsed.value.dialogue.complex_chat, "complex chat classification");
	require(!parsed.value.dialogue.camera_dialog, "camera dialogue classification");
	require(parsed.value.focus.task_id == 100101, "focused task");
	require(parsed.value.focus.completed_nodes == 2, "completed nodes");
	require(parsed.value.focus.remaining_nodes == 4, "remaining nodes");
	require(parsed.value.focus.total_nodes == 7, "total nodes");
	require(parsed.value.focus.progress_known, "known progress");
	require(parsed.value.focus.has_branches, "focus branch flag");
	require(parsed.value.progress.size() == 1, "progress count");
	require(parsed.value.progress[0].task_id == 100101, "progress task id");
	require(parsed.value.progress[0].completed_nodes == 2, "progress completed nodes");
	require(parsed.value.progress[0].total_nodes == 7, "progress total nodes");
	require(parsed.value.progress[0].has_branches, "progress branch flag");
	require(parsed.value.progress[0].progress_known, "progress known");
	require(!parsed.value.task_nodes_truncated, "task nodes not truncated");
	require(parsed.value.task_nodes.size() == 1, "task node count");
	require(parsed.value.task_nodes[0].task_id == 100100, "task node id");
	require(parsed.value.task_nodes[0].status == 2, "task node status");
	require(parsed.value.task_nodes[0].status_inferred, "task node inferred status");
	require(!parsed.value.task_nodes[0].subtask_edge, "task node relation");
	require(parsed.value.task_nodes[0].name == "Previous", "task node name");
	require(parsed.value.events.size() == 1, "event count");

	const seria_qa::parse_result utf8_bom = seria_qa::parse_snapshot(
		std::string("\xef\xbb\xbf", 3) + valid);
	require(utf8_bom.valid, utf8_bom.error.c_str());
	require(utf8_bom.value.sequence == 42, "UTF-8 BOM sequence");

	const seria_qa::parse_result utf16le = seria_qa::parse_snapshot(encode_utf16le_ascii(valid));
	require(utf16le.valid, utf16le.error.c_str());
	require(utf16le.value.sequence == 42, "UTF-16LE sequence");
	require(utf16le.value.tasks[0].name == "Main\tTask", "UTF-16LE task name");

	const seria_qa::parse_result malformed_utf16le = seria_qa::parse_snapshot(
		std::string("\xff\xfeS", 3));
	require(!malformed_utf16le.valid, "odd-length UTF-16LE must fail");

	const seria_qa::parse_result legacy = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t1\t2\t10\tlegacy\nMETA\t1\t0\t0\nEND\t2\t1\n");
	require(!legacy.valid, "schema v1 must be rejected");

	const seria_qa::parse_result legacy_focus = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t2\t3\t10\tlegacy\n"
		"META\t1\t0\t0\n"
		"FOCUS\t100101\t1001\t4\t1\thud\n"
		"END\t3\t2\n");
	require(!legacy_focus.valid, "schema v2 must be rejected");

	const seria_qa::parse_result schema_three = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t3\t3\t10\tlegacy\n"
		"META\t1\t0\t0\n"
		"END\t3\t1\n");
	require(!schema_three.valid, "schema v3 must be rejected");

	const seria_qa::parse_result schema_four = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t4\t3\t10\tlegacy\n"
		"META\t1\t0\t0\t0\n"
		"END\t3\t1\n");
	require(!schema_four.valid, "schema v4 must be rejected");

	const seria_qa::parse_result schema_five = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t5\t3\t10\tlegacy\n"
		"META\t1\t0\t0\t0\n"
		"END\t3\t1\n");
	require(!schema_five.valid, "schema v5 must be rejected");

	const seria_qa::parse_result inconsistent_progress = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t4\t10\tprogress\n"
		"FOCUS\t100101\t1001\t2\t4\t8\t0\t1\thud\n"
		"END\t4\t1\n");
	require(!inconsistent_progress.valid, "inconsistent FOCUS progress must fail");

	const seria_qa::parse_result inconsistent_task_progress = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t5\t10\tprogress\n"
		"PROGRESS\t100101\t1001\t2\t4\t8\t0\t1\n"
		"END\t5\t1\n");
	require(!inconsistent_task_progress.valid, "inconsistent PROGRESS must fail");

	const seria_qa::parse_result malformed_task_progress = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t6\t10\tprogress\n"
		"PROGRESS\t100101\t1001\t2\t4\t7\t0\n"
		"END\t6\t1\n");
	require(!malformed_task_progress.valid, "short PROGRESS must fail");

	const seria_qa::parse_result malformed_task_node = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t7\t10\tnodes\n"
		"NODE\t1001\t100100\t0\t-1\t1\t2\t0\t1\t0\t0\t0\tName\tDescription\n"
		"END\t7\t1\n");
	require(!malformed_task_node.valid, "negative NODE depth must fail");

	const seria_qa::parse_result partial = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t2\t10\trefresh\nMETA\t1\t0\t0\t0\n");
	require(!partial.valid, "partial snapshot must fail");

	const seria_qa::parse_result wrong_count = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t2\t10\trefresh\nMETA\t1\t0\t0\t0\nEND\t2\t2\n");
	require(!wrong_count.valid, "record-count mismatch must fail");

	const seria_qa::parse_result unsafe_status = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t6\t2\t10\trefresh\n"
		"TASK\t1\t1\t99\t1\t1\t0\t1\t0\t0\t0\t0\t0\t0\tName\tDescription\n"
		"END\t2\t1\n");
	require(!unsafe_status.valid, "out-of-range status must fail");

	if (argc > 1)
	{
		std::ifstream stream(argv[1], std::ios::binary);
		std::ostringstream content;
		content << stream.rdbuf();
		require(stream.good() || stream.eof(), "generated snapshot read");
		const seria_qa::parse_result generated = seria_qa::parse_snapshot(content.str());
		require(generated.valid, generated.error.c_str());
		if (argc > 2 && std::string_view(argv[2]) == "--generated-fixture")
		{
			require(generated.value.tasks.size() == 1, "generated task count");
			require(generated.value.tasks[0].task_id == 100101, "generated task id");
			require(generated.value.tasks[0].traced, "generated traced state");
			require(generated.value.next.size() == 19, "generated candidate count");
			require(generated.value.navigation.task_id == 100101, "generated navigation task id");
			require(generated.value.dialogue.start_id == 400200, "generated dialogue id");
			require(generated.value.dialogue.current_id == 400203, "generated dialogue node id");
			require(generated.value.dialogue.complex_chat, "generated complex chat flag");
			require(!generated.value.dialogue.camera_dialog, "generated camera dialogue flag");
			require(generated.value.focus.task_id == 100101, "generated focused task id");
			require(generated.value.focus.completed_nodes == 1, "generated completed node count");
			require(generated.value.focus.remaining_nodes == 19, "generated remaining node count");
			require(generated.value.focus.total_nodes == 21, "generated total node count");
			require(generated.value.focus.progress_known, "generated progress known");
			require(generated.value.focus.has_branches, "generated focus branch flag");
			require(generated.value.progress.size() == 1, "generated progress count");
			require(generated.value.progress[0].task_id == 100101, "generated progress task id");
			require(generated.value.progress[0].completed_nodes == 1, "generated progress completed");
			require(generated.value.progress[0].remaining_nodes == 19, "generated progress remaining");
			require(generated.value.progress[0].total_nodes == 21, "generated progress total");
			require(generated.value.progress[0].has_branches, "generated progress branches");
			require(generated.value.progress[0].progress_known, "generated progress known flag");
			require(generated.value.task_nodes.size() == 21, "generated task node count");
			require(generated.value.task_nodes[0].task_id == 100100, "generated first node");
			require(generated.value.task_nodes[0].status == 2, "generated completed node");
			require(generated.value.task_nodes[0].status_inferred, "generated inferred node");
			require(!generated.value.task_nodes[0].held, "generated completed node not held");
			require(generated.value.task_nodes[1].task_id == 100101, "generated current node");
			require(generated.value.task_nodes[1].held, "generated current node held");
			require(generated.value.task_nodes[1].status == 1, "generated current node status");
		}
	}

	std::cout << "Snapshot parser tests passed.\n";
	return 0;
}
