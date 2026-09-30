import { useEffect, useId, useRef, useState } from "react";
import type { ConfigRecord, Detail, Field } from "./types";

type Props = {
  kind: "skill" | "buff"; career: Detail; operations: ConfigRecord[]; busy: boolean;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  onChange: (records: ConfigRecord[]) => void;
};
const identity = (r: ConfigRecord) => `${r.table}:${r.targetId}`;
const names: Record<string, string> = { skill: "技能", buff: "Buff", damage: "伤害", behavior: "行为", aura: "光环" };

export default function Authoring({ kind, career, operations, busy, api, onChange }: Props) {
  const formId = useId();
  const [table, setTable] = useState<string>(kind);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<ConfigRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [treeIds, setTreeIds] = useState<Record<string, string>>({});
  const [copyOpen, setCopyOpen] = useState(false);
  const generation = useRef(0);
  const effective = records.map(r => operations.find(o => identity(o) === identity(r)) ?? r);
  const current = effective.find(r => identity(r) === selected);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<{ results: typeof results }>("authoring", { action: "search", table, query })
        .then(data => { if (active) setResults(data.results); })
        .catch(e => { if (active) setError(e.message); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [table, query]);
  useEffect(() => () => { generation.current++; }, []);

  async function open(id: string, selectedTable = table) {
    const version = ++generation.current;
    setLoading(true); setError(""); setCopyOpen(false);
    try {
      const data = await api<{ records: ConfigRecord[] }>("authoring", { table: selectedTable, sourceId: id });
      if (generation.current !== version) return;
      setTable(selectedTable); setRecords(data.records); setSelected(identity(data.records[0]));
    } catch (e) { if (generation.current === version) setError((e as Error).message); }
    finally { if (generation.current === version) setLoading(false); }
  }
  function edit(field: Field, values: string[]) {
    if (!current) return;
    const next = { ...current, edits: { ...current.edits } };
    if (JSON.stringify(values) === JSON.stringify(field.values)) delete next.edits[field.name];
    else next.edits[field.name] = values;
    const others = operations.filter(o => identity(o) !== identity(current));
    onChange(Object.keys(next.edits).length || next.sourceId !== next.targetId ? [...others, next] : others);
  }
  async function clone() {
    if (!records.length) return;
    const version = ++generation.current;
    setLoading(true); setError("");
    try {
      const data = await api<{ records: ConfigRecord[] }>("authoring", {
        action: "clone", table: records[0].table, sourceId: records[0].sourceId,
        targetId: target, careerId: career.id, treeIds,
      });
      if (generation.current !== version) return;
      if (data.records.some(r => operations.some(o => identity(o) === identity(r)))) throw Error("这个目标 ID 已有草稿，请先处理该草稿。");
      // Preserve the visible template edits, then apply only the server's explicit remapping.
      const clones = data.records.map(r => ({
        ...r, edits: { ...effective.find(o => o.table === r.table && o.sourceId === r.sourceId)?.edits, ...r.edits },
      }));
      onChange([...operations, ...clones]);
      setRecords(clones); setSelected(identity(clones[0])); setCopyOpen(false); setTarget("");
    } catch (e) { if (generation.current === version) setError((e as Error).message); }
    finally { if (generation.current === version) setLoading(false); }
  }
  function fieldControl(field: Field) {
    if (!current) return null;
    const values = current.edits[field.name] ?? field.values;
    const changed = JSON.stringify(values) !== JSON.stringify(field.values);
    const array = values.length > 1;
    const fieldId = `${formId}-${identity(current)}-${field.name}`;
    const labelId = `${fieldId}-label`;
    const descriptionId = `${fieldId}-description`;
    return <div key={field.name} className={`field ${array ? "full" : ""} ${changed ? "changed" : ""}`}>
      <span className="field-label"><span id={labelId}>{field.label}</span>{changed && <span className="edited">已修改</span>}</span>
      <code id={descriptionId}>{field.name}</code>
      {field.choices ? <select id={fieldId} aria-labelledby={labelId} aria-describedby={descriptionId} value={values[0]} onChange={e => edit(field, [e.target.value])}>
        {!field.choices.includes(values[0]) && <option value={values[0]}>{values[0] || "未配置"}</option>}
        {field.choices.map(v => <option key={v} value={v}>{v}</option>)}
      </select> : array ? <div className="skill-slots">{values.slice(1, -1).map((v, i) => <label key={i}>
        <span id={`${fieldId}-slot-${i}-label`}>{field.labels[i + 1] || `槽位 ${i + 1}`}</span>
        <input id={`${fieldId}-slot-${i}`} aria-labelledby={`${labelId} ${fieldId}-slot-${i}-label`} aria-describedby={descriptionId} value={v} onChange={e => {
          const next = [...values]; next[i + 1] = e.target.value; edit(field, next);
        }} /></label>)}</div> :
        <textarea id={fieldId} aria-labelledby={labelId} aria-describedby={descriptionId} rows={/description|tips|attr|effectperlvnew/.test(field.name) ? 3 : 1}
          value={values[0]} onChange={e => edit(field, [e.target.value])} />}
    </div>;
  }

  return <section className="form-section authoring" aria-busy={loading}>
    <div className="section-heading"><h3>{kind === "skill" ? "技能配置" : "Buff 与效果配置"}</h3>
      <span>修改汇入当前职业草稿</span></div>
    {kind === "skill" && <div className="linked-skills">
      <label htmlFor="linked-skill">当前职业技能</label>
      <select id="linked-skill" value="" disabled={loading || busy} onChange={e => void open(e.target.value, "skill")}>
        <option value="">选择关联技能 · {career.skills.length} 项</option>
        {career.skills.map(s => <option key={s.id} value={s.id}>{s.id} · {s.name || "未命名"} · {s.basis}</option>)}
      </select>
    </div>}
    <div className="authoring-search">
      <label>配置类型<select aria-label="配置类型" value={table} disabled={loading || busy} onChange={e => {
        setTable(e.target.value); setRecords([]); setSelected(""); setResults([]); setCopyOpen(false);
      }}>{Object.entries(names).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      <label>全库检索<input value={query} onChange={e => setQuery(e.target.value)} placeholder="ID / 名称" /></label>
      <label>检索结果<select aria-label="检索结果" value="" disabled={loading || busy} onChange={e => void open(e.target.value)}>
        <option value="">{results.length ? `选择记录 · 最多显示 60 项` : "没有匹配记录"}</option>
        {results.map(r => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
      </select></label>
    </div>
    <p className="hint">已有记录可能被多个职业共享。技能到伤害的入口由 Ability / 动画资产定义，请按明确的伤害 ID 打开；同号 Buff 不会自动关联。</p>
    {operations.length > 0 && <label className="draft-picker">已暂存配置<select aria-label="已暂存配置" value="" disabled={loading || busy} onChange={e => {
      const r = operations.find(o => identity(o) === e.target.value);
      if (r) { setRecords([r]); setSelected(identity(r)); setCopyOpen(false); }
    }}><option value="">选择草稿 · {operations.length} 行</option>{operations.map(r =>
      <option key={identity(r)} value={identity(r)}>{r.title} {r.targetId}{r.sourceId !== r.targetId ? " · 新建" : " · 修改"}</option>)}
    </select></label>}
    {error && <p className="warning" role="alert">{error}</p>}
    {loading && <p role="status">正在读取配置…</p>}
    {current ? <>
      <div className="record-heading"><label>编辑记录<select aria-label="编辑记录" value={selected} onChange={e => setSelected(e.target.value)}>
        {effective.map(r => <option key={identity(r)} value={identity(r)}>{r.title} · {r.targetId}{r.table === "upgrade" ? ` · ${Number(r.targetId) % 1000} 级` : ""}</option>)}
      </select></label>
        <button disabled={loading || busy || records[0].sourceId !== records[0].targetId}
          onClick={() => setCopyOpen(!copyOpen)}>从此模板新建</button></div>
      {copyOpen && <div className="authoring-copy">
        <label>新{names[records[0].table] || records[0].title} ID<input value={target} onChange={e => setTarget(e.target.value)} /></label>
        {records.filter(r => r.table === "tree").map(r => <label key={r.sourceId}>新技能树 ID（模板 {r.sourceId}）
          <input value={treeIds[r.sourceId] ?? ""} onChange={e => setTreeIds({ ...treeIds, [r.sourceId]: e.target.value })} /></label>)}
        <p className="hint">技能新建同步复制模板技能树与全部升级行。Ability、伤害和外部依赖继续复用；Buff、行为与光环按需另建并填写引用。</p>
        <button disabled={loading || busy || !target} onClick={() => void clone()}>生成新建草稿</button>
      </div>}
      <p className="hint">{current.sourceId !== current.targetId ? `新建 ${current.targetId} · 复制模板 ${current.sourceId}` : `编辑已有 ${current.targetId}`} · {effective.length} 条关联记录
        {records[0].table === "skill" ? " · 技能树及升级参数可从上方切换" : ""}</p>
      <fieldset disabled={busy || loading} className="authoring-fields">
        {current.groups.map((group, index) => <details key={`${identity(current)}:${group.title}`} open={index === 0 || undefined}>
          <summary>{group.title}<span>{group.fields.length} 个配置项</span></summary>
          <div className="fields">{group.fields.map(fieldControl)}</div>
        </details>)}
      </fieldset>
      <p className="hint">公式保持项目原有语法；面板不执行公式。未适配字段随模板保留，最终效果需导表和游戏验证。</p>
    </> : !loading && <p className="empty-small">选择一条记录开始配置，或作为新技能 / Buff 的模板。</p>}
  </section>;
}
