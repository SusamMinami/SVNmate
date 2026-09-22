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
		"SERIA_QA_SNAPSHOT\t2\t42\t123456\taccept%2Crefresh\n"
		"META\t1\t1\t0\n"
		"TASK\t100101\t1001\t1\t1\t2\t3\t1\t1\t1\t0\t0\t0\t0\tMain%09Task\tLine%0AOne\n"
		"NEXT\t100101\t1\t1\t100102\tNext%25Task\n"
		"TRACE\t1\t1001\n"
		"NAV\t1\t1\t100101\t2001\t2\t3001\n"
		"DIALOG\t1\t400100\t400103\t100101\t1001\n"
		"FOCUS\t100101\t1001\t4\t1\tnavigation\n"
		"EVENT\t7\t123450\taccepted\t100101\t1001\t1\tMain\n"
		"END\t42\t8\n";

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
	require(parsed.value.focus.task_id == 100101, "focused task");
	require(parsed.value.focus.remaining_nodes == 4, "remaining nodes");
	require(parsed.value.focus.has_branches, "focus branch flag");
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
	require(legacy.valid, "schema v1 remains supported");

	const seria_qa::parse_result partial = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t1\t2\t10\trefresh\nMETA\t1\t0\t0\n");
	require(!partial.valid, "partial snapshot must fail");

	const seria_qa::parse_result wrong_count = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t1\t2\t10\trefresh\nMETA\t1\t0\t0\nEND\t2\t2\n");
	require(!wrong_count.valid, "record-count mismatch must fail");

	const seria_qa::parse_result unsafe_status = seria_qa::parse_snapshot(
		"SERIA_QA_SNAPSHOT\t1\t2\t10\trefresh\n"
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
			require(generated.value.next.size() == 2, "generated candidate count");
			require(generated.value.navigation.task_id == 100101, "generated navigation task id");
			require(generated.value.dialogue.start_id == 400100, "generated dialogue id");
			require(generated.value.focus.task_id == 100101, "generated focused task id");
			require(generated.value.focus.remaining_nodes == 2, "generated remaining node count");
			require(generated.value.focus.has_branches, "generated focus branch flag");
		}
	}

	std::cout << "Snapshot parser tests passed.\n";
	return 0;
}
