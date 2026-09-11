import hashlib
import json
import math
import unreal


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode("utf8")).hexdigest()


def package_dirty(sequence):
    package = sequence.get_outermost()
    return any(p.get_path_name() == package.get_path_name()
               for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())


def tracks_for(sequence):
    tracks = [(track, "") for track in sequence.get_master_tracks()]
    for binding in sequence.get_bindings():
        tracks.extend((track, str(binding.get_name())) for track in binding.get_tracks())
    return tracks


def snapshot(sequence):
    rate = sequence.get_display_rate()
    tick = sequence.get_tick_resolution()
    fps = float(rate.numerator) / rate.denominator
    tps = float(tick.numerator) / tick.denominator
    tracks, events, warnings = [], [], []
    for track, binding in tracks_for(sequence):
        sections = []
        for section in track.get_sections():
            entry = dict(path=section.get_path_name(), className=section.get_class().get_name(),
                         start=section.get_start_frame_seconds() if section.has_start_frame() else None,
                         end=section.get_end_frame_seconds() if section.has_end_frame() else None,
                         active=section.is_active())
            if isinstance(section, unreal.MovieSceneDialogueSection):
                entry["dialogueId"] = int(section.get_editor_property("dialogue_id"))
            if isinstance(section, unreal.MovieSceneSubSection):
                child = section.get_sequence()
                entry["subSequence"] = child.get_path_name() if child else ""
            if entry["className"] == "MovieSceneAkAudioEventSection":
                try:
                    entry["audioEvent"] = str(section.get_editor_property("event_name"))
                except Exception as error:
                    warnings.append("Audio event unreadable: " + str(error))
            if isinstance(section, unreal.MovieSceneEventTriggerSection):
                for ci, channel in enumerate(section.get_channels()):
                    for ki, key in enumerate(channel.get_keys()):
                        frame = key.get_time(time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION).frame_number.value
                        events.append(dict(sectionPath=section.get_path_name(), channel=ci, key=ki,
                                           frame=frame, seconds=frame / tps, endpoint="", role="other"))
            sections.append(entry)
        tracks.append(dict(path=track.get_path_name(), name=str(track.get_display_name()),
                           className=track.get_class().get_name(), binding=binding, sections=sections))
    marks = [dict(label=str(mark.label), frame=mark.frame_number.value,
                  seconds=mark.frame_number.value / tps) for mark in sequence.get_marked_frames()]
    state = dict(assetPath=sequence.get_path_name(), name=sequence.get_name(), dirty=package_dirty(sequence),
                 displayRate=fps, tickResolution=tps,
                 start=sequence.get_playback_start_seconds(), end=sequence.get_playback_end_seconds(),
                 tracks=tracks, events=events, marks=marks, warnings=warnings)
    state["stateRevision"] = digest(state)
    return state


def require_idle():
    if unreal.EditorLevelLibrary.get_game_world():
        raise RuntimeError("EDITOR_BUSY: Stop PIE before editing sequences")


def load_sequence(path):
    sequence = unreal.load_asset(path)
    if not isinstance(sequence, unreal.LevelSequence):
        raise RuntimeError("ASSET_NOT_FOUND: Expected LevelSequence")
    return sequence


def apply_patch(request):
    require_idle()
    sequence = load_sequence(request["assetPath"])
    before = snapshot(sequence)
    if before["dirty"]:
        raise RuntimeError("DIRTY_ASSET: Save the sequence first")
    if before["stateRevision"] != request["stateRevision"]:
        raise RuntimeError("REVISION_CONFLICT: Sequence changed after review")
    patch = request["patch"]
    tps = before["tickResolution"]
    track_objects = tracks_for(sequence)
    section_objects = {s.get_path_name(): s for t, _ in track_objects for s in t.get_sections()}
    dialogue_tracks = [t for t, _ in track_objects if isinstance(t, unreal.MovieSceneDialogueTrack)]
    if patch["subtitles"] and len(dialogue_tracks) > 1:
        raise RuntimeError("Multiple dialogue tracks")
    original_marks = [mark.copy() for mark in sequence.get_marked_frames()]
    originals, created_sections, created_tracks, moved = [], [], [], []
    # Resolve key objects before moving anything: moving a key changes sorted indices.
    for target in request["eventTargets"]:
        section = section_objects[target["sectionPath"]]
        keys = section.get_channels()[target["channel"]].get_keys()
        key = keys[target["key"]]
        old = key.get_time(time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION).frame_number.value
        new = int(math.floor(target["seconds"] * tps + 0.5))
        if any(k.get_time(time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION).frame_number.value == new
               for i, k in enumerate(keys) if i != target["key"]):
            raise RuntimeError("EVENT_COLLISION: Target frame already has an event")
        moved.append((section, key, old, new))
    changed_marks = False
    with unreal.ScopedEditorTransaction("Animation voice configuration"):
        try:
            sequence.modify()
            sequence.get_movie_scene().modify()
            for draft in patch["subtitles"]:
                path = draft.get("sectionPath")
                if path:
                    section = section_objects[path]
                    originals.append((section, section.get_editor_property("dialogue_id"),
                                      section.get_editor_property("section_range").copy()))
                    section.modify()
                else:
                    if not dialogue_tracks:
                        track = sequence.add_master_track(unreal.MovieSceneDialogueTrack)
                        if not track:
                            raise RuntimeError("Could not create dialogue track")
                        created_tracks.append(track)
                        dialogue_tracks.append(track)
                    track = dialogue_tracks[0]
                    track.modify()
                    section = track.add_section()
                    created_sections.append((track, section))
                section.set_editor_property("dialogue_id", draft["dialogueId"])
                section.set_range_seconds(draft["start"], draft["end"])
                if (int(section.get_editor_property("dialogue_id")) != draft["dialogueId"] or
                    abs(section.get_start_frame_seconds() - draft["start"]) > 1.1 / tps or
                    abs(section.get_end_frame_seconds() - draft["end"]) > 1.1 / tps):
                    raise RuntimeError("READBACK_MISMATCH: Subtitle")
            if patch["skipTime"] is not None:
                changed_marks = True
                marks = list(sequence.get_marked_frames())
                indices = [i for i, m in enumerate(marks) if str(m.label) == "skip"]
                if len(indices) > 1:
                    raise RuntimeError("Multiple skip marks")
                frame = int(math.floor(patch["skipTime"] * tps + 0.5))
                if indices:
                    sequence.set_marked_frame(indices[0], unreal.FrameNumber(frame))
                else:
                    index = sequence.add_marked_frame(unreal.MovieSceneMarkedFrame(
                        frame_number=unreal.FrameNumber(frame), label="skip"))
                    if index < 0:
                        raise RuntimeError("Could not create skip mark")
                if not any(str(m.label) == "skip" and m.frame_number.value == frame for m in sequence.get_marked_frames()):
                    raise RuntimeError("READBACK_MISMATCH: skip mark")
            for section, key, old, new in moved:
                section.modify()
                key.set_time(unreal.FrameNumber(new), time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION)
                if key.get_time(time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION).frame_number.value != new:
                    raise RuntimeError("READBACK_MISMATCH: event time")
            after = snapshot(sequence)
            return dict(applied=True, snapshot=after)
        except Exception as error:
            try:
                for section, key, old, new in reversed(moved):
                    if key.get_time(time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION).frame_number.value != old:
                        key.set_time(unreal.FrameNumber(old), time_unit=unreal.SequenceTimeUnit.TICK_RESOLUTION)
                if changed_marks:
                    sequence.delete_marked_frames()
                    for mark in original_marks:
                        sequence.add_marked_frame(mark)
                for section, dialogue_id, original_range in originals:
                    section.set_editor_property("dialogue_id", dialogue_id)
                    section.set_editor_property("section_range", original_range)
                for track, section in reversed(created_sections):
                    track.remove_section(section)
                for track in reversed(created_tracks):
                    sequence.remove_master_track(track)
                restored = snapshot(sequence)
                if any(restored[field] != before[field] for field in ("tracks", "events", "marks")):
                    raise RuntimeError("Rollback readback mismatch")
            except Exception as rollback:
                raise RuntimeError("ROLLBACK_FAILED: " + str(error) + "; " + str(rollback))
            raise RuntimeError("APPLY_FAILED (restored, not saved): " + str(error))


def run(request):
    action = request["action"]
    if action == "catalog":
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        if registry.is_loading_assets():
            raise RuntimeError("EDITOR_BUSY: Asset registry is still loading")
        assets = registry.get_assets_by_path(request["root"], recursive=True)
        return sorted([dict(path=str(a.object_path), name=str(a.asset_name))
                       for a in assets if str(a.asset_class) == "LevelSequence"], key=lambda a: a["path"])
    if action == "scan":
        return snapshot(load_sequence(request["assetPath"]))
    if action == "apply":
        return apply_patch(request)
    raise RuntimeError("Unsupported animation voice action")


_result = run(_request)
