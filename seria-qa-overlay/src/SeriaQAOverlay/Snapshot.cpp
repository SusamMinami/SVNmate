#include "Snapshot.hpp"

#include <charconv>
#include <limits>

namespace seria_qa
{
	namespace
	{
		constexpr size_t max_snapshot_bytes = 512 * 1024;
		constexpr size_t max_tasks = 2048;
		constexpr size_t max_next_records = 4096;
		constexpr size_t max_events = 64;

		bool append_utf8(uint32_t code_point, std::string &output)
		{
			if (code_point <= 0x7f)
			{
				output.push_back(static_cast<char>(code_point));
			}
			else if (code_point <= 0x7ff)
			{
				output.push_back(static_cast<char>(0xc0 | (code_point >> 6)));
				output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
			}
			else if (code_point <= 0xffff)
			{
				if (code_point >= 0xd800 && code_point <= 0xdfff)
					return false;
				output.push_back(static_cast<char>(0xe0 | (code_point >> 12)));
				output.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
				output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
			}
			else if (code_point <= 0x10ffff)
			{
				output.push_back(static_cast<char>(0xf0 | (code_point >> 18)));
				output.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3f)));
				output.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
				output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
			}
			else
			{
				return false;
			}
			return true;
		}

		bool normalize_encoding(
			std::string_view input,
			std::string &storage,
			std::string_view &output,
			std::string &error)
		{
			output = input;
			if (input.size() >= 3 &&
				static_cast<unsigned char>(input[0]) == 0xef &&
				static_cast<unsigned char>(input[1]) == 0xbb &&
				static_cast<unsigned char>(input[2]) == 0xbf)
			{
				output.remove_prefix(3);
				return true;
			}
			if (input.size() < 2)
				return true;

			const unsigned char first = static_cast<unsigned char>(input[0]);
			const unsigned char second = static_cast<unsigned char>(input[1]);
			if (first == 0xfe && second == 0xff)
			{
				error = "UTF-16BE snapshots are unsupported";
				return false;
			}
			if (first != 0xff || second != 0xfe)
				return true;
			if ((input.size() - 2) % 2 != 0)
			{
				error = "UTF-16LE snapshot has an odd byte count";
				return false;
			}

			storage.clear();
			storage.reserve((input.size() - 2) / 2);
			for (size_t index = 2; index < input.size(); index += 2)
			{
				uint32_t code_point =
					static_cast<unsigned char>(input[index]) |
					(static_cast<uint32_t>(static_cast<unsigned char>(input[index + 1])) << 8);
				if (code_point >= 0xd800 && code_point <= 0xdbff)
				{
					if (index + 3 >= input.size())
					{
						error = "UTF-16LE snapshot ends in a high surrogate";
						return false;
					}
					const uint32_t low =
						static_cast<unsigned char>(input[index + 2]) |
						(static_cast<uint32_t>(static_cast<unsigned char>(input[index + 3])) << 8);
					if (low < 0xdc00 || low > 0xdfff)
					{
						error = "UTF-16LE snapshot has an invalid surrogate pair";
						return false;
					}
					code_point = 0x10000 + ((code_point - 0xd800) << 10) + (low - 0xdc00);
					index += 2;
				}
				if (!append_utf8(code_point, storage))
				{
					error = "UTF-16LE snapshot contains an invalid code point";
					return false;
				}
			}
			output = storage;
			return true;
		}

		std::vector<std::string_view> split(std::string_view text, char delimiter)
		{
			std::vector<std::string_view> fields;
			size_t start = 0;
			for (;;)
			{
				const size_t end = text.find(delimiter, start);
				fields.push_back(text.substr(start, end == std::string_view::npos ? end : end - start));
				if (end == std::string_view::npos)
					break;
				start = end + 1;
			}
			return fields;
		}

		bool parse_int64(std::string_view text, int64_t &value)
		{
			if (text.empty())
				return false;
			const char *const begin = text.data();
			const char *const end = begin + text.size();
			const auto result = std::from_chars(begin, end, value);
			return result.ec == std::errc() && result.ptr == end;
		}

		bool parse_uint64(std::string_view text, uint64_t &value)
		{
			if (text.empty())
				return false;
			const char *const begin = text.data();
			const char *const end = begin + text.size();
			const auto result = std::from_chars(begin, end, value);
			return result.ec == std::errc() && result.ptr == end;
		}

		bool parse_int(std::string_view text, int &value)
		{
			int64_t wide = 0;
			if (!parse_int64(text, wide) ||
				wide < std::numeric_limits<int>::min() ||
				wide > std::numeric_limits<int>::max())
				return false;
			value = static_cast<int>(wide);
			return true;
		}

		bool parse_bool(std::string_view text, bool &value)
		{
			if (text == "0")
			{
				value = false;
				return true;
			}
			if (text == "1")
			{
				value = true;
				return true;
			}
			return false;
		}

		int hex_value(char value)
		{
			if (value >= '0' && value <= '9')
				return value - '0';
			if (value >= 'A' && value <= 'F')
				return value - 'A' + 10;
			if (value >= 'a' && value <= 'f')
				return value - 'a' + 10;
			return -1;
		}

		bool decode_field(std::string_view encoded, std::string &decoded)
		{
			decoded.clear();
			decoded.reserve(encoded.size());
			for (size_t index = 0; index < encoded.size(); ++index)
			{
				if (encoded[index] != '%')
				{
					decoded.push_back(encoded[index]);
					continue;
				}
				if (index + 2 >= encoded.size())
					return false;
				const int high = hex_value(encoded[index + 1]);
				const int low = hex_value(encoded[index + 2]);
				if (high < 0 || low < 0)
					return false;
				decoded.push_back(static_cast<char>((high << 4) | low));
				index += 2;
			}
			return true;
		}

		parse_result fail(size_t line_number, std::string_view reason)
		{
			parse_result result;
			result.error = "line " + std::to_string(line_number) + ": " + std::string(reason);
			return result;
		}
	}

	parse_result parse_snapshot(std::string_view text)
	{
		if (text.size() > max_snapshot_bytes * 2 + 2)
			return fail(0, "encoded snapshot exceeds limit");

		std::string normalized;
		std::string encoding_error;
		std::string_view normalized_view;
		if (!normalize_encoding(text, normalized, normalized_view, encoding_error))
			return fail(0, encoding_error);
		text = normalized_view;

		if (text.empty())
			return fail(0, "empty snapshot");
		if (text.size() > max_snapshot_bytes)
			return fail(0, "snapshot exceeds 512 KiB");

		parse_result result;
		size_t line_number = 0;
		size_t record_count = 0;
		size_t start = 0;
		bool saw_header = false;
		bool saw_end = false;

		while (start <= text.size())
		{
			size_t end = text.find('\n', start);
			if (end == std::string_view::npos)
				end = text.size();
			std::string_view line = text.substr(start, end - start);
			if (!line.empty() && line.back() == '\r')
				line.remove_suffix(1);
			start = end + 1;
			++line_number;

			if (line.empty())
			{
				if (end == text.size())
					break;
				continue;
			}
			if (saw_end)
				return fail(line_number, "data follows END marker");

			const std::vector<std::string_view> fields = split(line, '\t');
			if (!saw_header)
			{
				if (fields.size() != 5 || fields[0] != "SERIA_QA_SNAPSHOT")
					return fail(line_number, "invalid header");
				int schema_version = 0;
				if (!parse_int(fields[1], schema_version) ||
					schema_version < 1 || schema_version > 2)
					return fail(line_number, "unsupported schema");
				result.value.schema_version = static_cast<uint32_t>(schema_version);
				if (!parse_uint64(fields[2], result.value.sequence) ||
					!parse_int64(fields[3], result.value.generated_at_ms) ||
					!decode_field(fields[4], result.value.reasons))
					return fail(line_number, "invalid header fields");
				saw_header = true;
				continue;
			}

			if (fields[0] == "END")
			{
				uint64_t sequence = 0;
				uint64_t expected_records = 0;
				if (fields.size() != 3 ||
					!parse_uint64(fields[1], sequence) ||
					!parse_uint64(fields[2], expected_records) ||
					sequence != result.value.sequence ||
					expected_records != record_count)
					return fail(line_number, "invalid END marker");
				saw_end = true;
				continue;
			}

			++record_count;
			if (fields[0] == "META")
			{
				if (fields.size() != 4 ||
					!parse_bool(fields[1], result.value.task_list_ready) ||
					!parse_int(fields[2], result.value.server_task_count) ||
					!parse_int(fields[3], result.value.client_task_count))
					return fail(line_number, "invalid META record");
			}
			else if (fields[0] == "TASK")
			{
				if (fields.size() != 16 || result.value.tasks.size() >= max_tasks)
					return fail(line_number, "invalid or excessive TASK record");
				task_record record;
				if (!parse_int64(fields[1], record.task_id) ||
					!parse_int64(fields[2], record.task_line_id) ||
					!parse_int(fields[3], record.status) ||
					!parse_int(fields[4], record.task_class) ||
					!parse_int(fields[5], record.mission_type) ||
					!parse_int64(fields[6], record.value) ||
					!parse_bool(fields[7], record.active) ||
					!parse_bool(fields[8], record.traced) ||
					!parse_bool(fields[9], record.shown) ||
					!parse_bool(fields[10], record.client) ||
					!parse_bool(fields[11], record.subtask) ||
					!parse_bool(fields[12], record.parallel) ||
					!parse_bool(fields[13], record.auto_next) ||
					!decode_field(fields[14], record.name) ||
					!decode_field(fields[15], record.description))
					return fail(line_number, "invalid TASK fields");
				if (record.status < -1 || record.status > 4)
					return fail(line_number, "TASK status is out of range");
				result.value.tasks.push_back(std::move(record));
			}
			else if (fields[0] == "NEXT")
			{
				if (fields.size() != 6 || result.value.next.size() >= max_next_records)
					return fail(line_number, "invalid or excessive NEXT record");
				next_record record;
				if (!parse_int64(fields[1], record.parent_task_id) ||
					!parse_int(fields[2], record.index) ||
					!parse_bool(fields[3], record.selected) ||
					!parse_int64(fields[4], record.task_id) ||
					!decode_field(fields[5], record.name))
					return fail(line_number, "invalid NEXT fields");
				result.value.next.push_back(std::move(record));
			}
			else if (fields[0] == "TRACE")
			{
				if (fields.size() != 3)
					return fail(line_number, "invalid TRACE record");
				trace_record record;
				if (!parse_int(fields[1], record.main_type) ||
					!parse_int64(fields[2], record.task_line_id))
					return fail(line_number, "invalid TRACE fields");
				result.value.traces.push_back(record);
			}
			else if (fields[0] == "NAV")
			{
				if (fields.size() != 7 ||
					!parse_bool(fields[1], result.value.navigation.guide_active) ||
					!parse_bool(fields[2], result.value.navigation.auto_moving) ||
					!parse_int64(fields[3], result.value.navigation.task_id) ||
					!parse_int64(fields[4], result.value.navigation.map_id) ||
					!parse_int(fields[5], result.value.navigation.target_type) ||
					!parse_int64(fields[6], result.value.navigation.target_id))
					return fail(line_number, "invalid NAV record");
			}
			else if (fields[0] == "DIALOG")
			{
				if (fields.size() != 6 ||
					!parse_bool(fields[1], result.value.dialogue.active) ||
					!parse_int64(fields[2], result.value.dialogue.start_id) ||
					!parse_int64(fields[3], result.value.dialogue.current_id) ||
					!parse_int64(fields[4], result.value.dialogue.task_id) ||
					!parse_int64(fields[5], result.value.dialogue.task_line_id))
					return fail(line_number, "invalid DIALOG record");
			}
			else if (fields[0] == "FOCUS")
			{
				if (fields.size() != 6 ||
					!parse_int64(fields[1], result.value.focus.task_id) ||
					!parse_int64(fields[2], result.value.focus.task_line_id) ||
					!parse_int(fields[3], result.value.focus.remaining_nodes) ||
					!parse_bool(fields[4], result.value.focus.has_branches) ||
					!decode_field(fields[5], result.value.focus.source) ||
					result.value.focus.remaining_nodes < 0)
					return fail(line_number, "invalid FOCUS record");
			}
			else if (fields[0] == "EVENT")
			{
				if (fields.size() != 8 || result.value.events.size() >= max_events)
					return fail(line_number, "invalid or excessive EVENT record");
				event_record record;
				if (!parse_uint64(fields[1], record.sequence) ||
					!parse_int64(fields[2], record.time_ms) ||
					!decode_field(fields[3], record.kind) ||
					!parse_int64(fields[4], record.task_id) ||
					!parse_int64(fields[5], record.task_line_id) ||
					!parse_int(fields[6], record.status) ||
					!decode_field(fields[7], record.label))
					return fail(line_number, "invalid EVENT fields");
				result.value.events.push_back(std::move(record));
			}
			else
			{
				return fail(line_number, "unknown record type");
			}

			if (end == text.size())
				break;
		}

		if (!saw_header || !saw_end)
			return fail(line_number, "snapshot is incomplete");

		result.valid = true;
		return result;
	}
}
