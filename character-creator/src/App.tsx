import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Copy, Database, FileSpreadsheet, FolderOpen,
  LoaderCircle, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import type { Detail, Draft, Edits, Field, Review, Summary } from "./types";
import Authoring from "./Authoring";

const emptyDraft = (id: string): Draft => ({ edits: {}, clone: false, targetId: id });
const modules = ["基础配置", "成长与介绍", "技能配置", "Buff 配置", "表关系"] as const;
const flags = new Set(["Gender", "transferable", "onoffswitch", "IsIntroChar", "Isouterchar"]);
const longFields = new Set(["bp", "attack", "initialattr", "initialequip", "initialitem", "mainmechanism"]);
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
type Receipt = { signature: string; mode: string; result: { message: string; paths: string[] } };

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [doc, setDoc] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [selected, setSelected] = useState("100");
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const detail = loadedDetail?.id === selected ? loadedDetail : null;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [module, setModule] = useState<(typeof modules)[number]>("基础配置");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("copy");
  const [busy, setBusy] = useState("正在读取本地配置");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const session = useRef("");
  const cache = useRef<Record<string, Detail>>({});
  const revision = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const draft = drafts[selected] ?? emptyDraft(selected);
  const receipt = receipts[selected];
  const result = receipt?.signature === JSON.stringify(draft) ? receipt.result : null;
  const writtenToTarget = Boolean(result) && receipt?.mode === mode;

  async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Session-Token": session.current, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  }

  useEffect(() => {
    let active = true;
    fetch("/api/bootstrap").then(r => r.json()).then(data => {
      if (!active) return;
      session.current = data.token;
      setSummary(data); setDoc(data.doc || data.suggestedDoc || "");
      setError(data.initialError || ""); setDirectoryOpen(!data.loaded);
      if (data.careers?.length) setSelected(data.careers.some((c: { id: string }) => c.id === "100") ? "100" : data.careers[0].id);
      if (data.loaded) {
        try {
          setDrafts(JSON.parse(sessionStorage.getItem(`draft:${data.doc}:${data.snapshot}`) || "{}"));
          setReceipts(JSON.parse(sessionStorage.getItem(`receipts:${data.doc}:${data.snapshot}`) || "{}"));
        } catch { /* A corrupt local draft is ignored. */ }
      }
    }).catch(e => active && setError(String(e))).finally(() => active && setBusy(""));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (summary?.loaded) {
      try {
        sessionStorage.setItem(`draft:${summary.doc}:${summary.snapshot}`, JSON.stringify(drafts));
        sessionStorage.setItem(`receipts:${summary.doc}:${summary.snapshot}`, JSON.stringify(receipts));
      } catch { /* Editing still works if session storage is unavailable. */ }
    }
  }, [drafts, receipts, summary]);

  useEffect(() => {
    if (!summary?.loaded) return;
    let active = true;
    setReview(null); setError("");
    if (cache.current[selected]) { setDetail(cache.current[selected]); setBusy(""); return; }
    setDetail(null); setBusy("正在读取职业与技能引用");
    api<Detail>(`careers/${selected}`).then(data => {
      if (active) { cache.current[selected] = data; setDetail(data); }
    }).catch(e => active && setError(String(e.message))).finally(() => active && setBusy(""));
    return () => { active = false; };
  }, [selected, summary]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (Object.values(drafts).some(d => d.clone || d.operations?.length || Object.values(d.edits).some(f => Object.keys(f).length))) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [drafts]);

  function updateDraft(next: Draft) {
    revision.current += 1;
    setDrafts(previous => ({ ...previous, [selected]: next }));
    setReview(null); setError("");
  }
  function edit(section: string, field: Field, values: string[]) {
    const edits: Edits = { ...draft.edits, [section]: { ...draft.edits[section] } };
    if (same(values, field.values)) delete edits[section][field.name];
    else edits[section][field.name] = values;
    updateDraft({ ...draft, edits });
  }
  const changes = detail?.sections.flatMap(section => section.fields
    .filter(f => draft.edits[section.key]?.[f.name])
    .map(f => ({ section: section.title, field: f, after: draft.edits[section.key][f.name] }))) ?? [];
  const operations = draft.operations ?? [];
  const count = changes.length + (draft.clone ? 1 : 0) + operations.length;
  const careers = summary?.careers?.filter(c => `${c.id} ${c.name} ${c.family}`.toLowerCase().includes(query.toLowerCase())) ?? [];

  async function load() {
    setBusy("正在读取 CSV 快照"); setError("");
    try {
      const data = await api<Summary>("load", { doc });
      cache.current = {}; setDetail(null); setSummary(data); setDirectoryOpen(false);
      setSelected(data.careers.some(c => c.id === selected) ? selected : data.careers[0]?.id ?? "");
      try {
        setDrafts(JSON.parse(sessionStorage.getItem(`draft:${data.doc}:${data.snapshot}`) || "{}"));
        setReceipts(JSON.parse(sessionStorage.getItem(`receipts:${data.doc}:${data.snapshot}`) || "{}"));
      } catch { setDrafts({}); setReceipts({}); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function prepare() {
    if (draft.clone && draft.targetId === selected) {
      setError("复制草稿需要一个不同于模板的未使用职业 ID"); return;
    }
    setBusy("正在核对源工作簿与差异"); setError("");
    const currentRevision = revision.current;
    try {
      const data = await api<Review>("prepare", { sourceId: selected, targetId: draft.clone ? draft.targetId : selected, edits: draft.edits,
        operations: operations.map(({ table, sourceId, targetId, edits }) => ({ table, sourceId, targetId, edits })), mode });
      if (revision.current !== currentRevision) {
        setError("审核期间草稿或写入目标已改变，请重新检查差异"); return;
      }
      setReview(data); dialog.current?.showModal();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function commit() {
    if (!review) return;
    setBusy("Excel 正在逐表写入与回读"); setError("");
    try {
      const written = await api<Receipt["result"]>("commit", { token: review.token });
      setReceipts(previous => ({ ...previous, [selected]: {
        signature: JSON.stringify(draft), mode: review.mode, result: written,
      } }));
      setReview(null); dialog.current?.close();
    } catch (e) {
      setError(`${(e as Error).message}。写入未确认时请先检查 Excel 会话，再重新审核。`);
      setReview(null); dialog.current?.close();
    } finally { setBusy(""); }
  }

  function renderField(section: string, field: Field) {
    const values = draft.edits[section]?.[field.name] ?? field.values;
    const changed = !same(values, field.values);
    const id = `${section}-${field.name}`;
    if (field.name === "initial_skill") return <fieldset className="array-field full" key={id}>
      <legend>初始技能 <code>initial_skill</code>{changed && <span className="edited">已修改</span>}</legend>
      <div className="skill-slots">{values.slice(1, -1).map((value, index) =>
        <label key={index}><span>槽位 {index + 1}</span>
          <input aria-label={`初始技能槽位 ${index + 1}`} placeholder="空槽" value={value} onChange={e => {
            const next = [...values]; next[index + 1] = e.target.value; edit(section, field, next);
          }} />
        </label>)}</div>
      <p className="hint">格式：技能ID;等级。空槽和重复项原样保留，关联技能页显示当前快照。</p>
    </fieldset>;
    return <label key={id} className={`field ${longFields.has(field.name) ? "full" : ""} ${changed ? "changed" : ""}`} htmlFor={id}>
      <span className="field-label">{field.label}{changed && <span className="edited">已修改</span>}</span>
      <code>{field.name}</code>
      {flags.has(field.name) ? <select id={id} value={values[0]} onChange={e => edit(section, field, [e.target.value])}>
        {!["0", "1"].includes(values[0]) && <option value={values[0]}>{values[0] || "未配置"}</option>}
        <option value="0">{field.name === "Gender" ? "女 · 0" : "否 · 0"}</option>
        <option value="1">{field.name === "Gender" ? "男 · 1" : "是 · 1"}</option>
      </select> : ["mainmechanism", "initialattr"].includes(field.name) ?
        <textarea id={id} rows={3} value={values[0]} onChange={e => edit(section, field, [e.target.value])} /> :
        <input id={id} value={values[0]} onChange={e => edit(section, field, [e.target.value])} />}
    </label>;
  }

  return <div className="app" aria-busy={Boolean(busy)}>
    <header className="topbar">
      <div className="brand"><FileSpreadsheet size={21} strokeWidth={1.7} /><h1>角色创建工具</h1><span className="tag">测试面板</span></div>
      <button className="source-button" onClick={() => setDirectoryOpen(!directoryOpen)} aria-expanded={directoryOpen}>
        <Database size={15} /><span>{summary?.loaded ? `${summary.careers.length} 个职业 · 本地快照` : "设置数据目录"}</span><ChevronRight size={14} />
      </button>
    </header>
    {directoryOpen && <section className="directory">
      <label htmlFor="doc-path">配置数据目录 <span className="muted">包含 csvdir 与 xlsdir</span></label>
      <div className="inline"><FolderOpen size={17} /><input id="doc-path" value={doc} onChange={e => setDoc(e.target.value)} placeholder="粘贴本机 doc 目录" />
        <button onClick={load} disabled={Boolean(busy) || !doc}>读取目录</button></div>
      {summary?.loaded && <p className="hint">当前来源：{summary.doc}。草稿按目录与快照保存于本次浏览器会话。</p>}
    </section>}
    <div className="workspace">
      <aside className="navigator" aria-label="职业列表">
        <div className="navigator-head"><strong>职业</strong><span className="muted">{careers.length}</span></div>
        <label className="search"><Search size={15} /><input aria-label="搜索职业" placeholder="ID / 名称 / Eric" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="career-list">{careers.map(c => <button key={c.id} className={`career ${selected === c.id ? "selected" : ""}`}
          aria-pressed={selected === c.id} disabled={Boolean(busy)} onClick={() => setSelected(c.id)}>
          <code>{c.id}</code><span><strong>{c.name}</strong><small>{c.family} · {c.role}</small></span>
          {drafts[c.id] && (drafts[c.id].clone || drafts[c.id].operations?.length || Object.values(drafts[c.id].edits).some(v => Object.keys(v).length)) && <span className="dirty-dot" title="有草稿" />}
        </button>)}
          {!careers.length && <p className="empty-small">{summary?.loaded ? "没有匹配职业，试试名称或 ID。" : "读取数据目录后显示职业。"}</p>}
        </div>
        <div className="nav-note"><span className="status-dot" /> CSV 只读快照<span>Excel 为配置源</span></div>
      </aside>
      <main>
        {detail ? <>
          <div className="editor-heading"><div><h2>{detail.name}<code>{detail.id}</code></h2><p>{detail.family} <span> / 职业配置</span></p></div>
            <button disabled={Boolean(busy)} onClick={() => updateDraft({ ...draft, clone: !draft.clone, targetId: draft.clone ? selected : "" })}>
              <Copy size={14} />{draft.clone ? "返回编辑已有职业" : "复制基础草稿"}</button>
          </div>
          {draft.clone && <div className="clone-strip"><label htmlFor="new-id">新职业 ID</label><input id="new-id" inputMode="numeric" value={draft.targetId} onChange={e => updateDraft({ ...draft, targetId: e.target.value })} placeholder="输入未使用的 ID" />
            <span>复制基础、成长、介绍与头像已有行；技能与资产仍复用模板。</span></div>}
          <nav className="modules" aria-label="配置模块">{modules.map(m => <button key={m} aria-current={m === module ? "page" : undefined} onClick={() => setModule(m)}>{m}</button>)}</nav>
          <div className="editor-scroll">
            {module === "基础配置" || module === "成长与介绍" ? detail.sections.filter(s => module === "基础配置" ? s.key === "career" : s.key !== "career").map(section =>
              <section className="form-section" key={section.key}><div className="section-heading"><h3>{section.title}</h3><span>{section.source}</span></div>
                <div className="fields">{section.fields.map(f => renderField(section.key, f))}</div>
              </section>) : module === "技能配置" || module === "Buff 配置" ?
                <Authoring key={`${summary?.doc}:${summary?.snapshot}:${selected}:${module}`} kind={module === "技能配置" ? "skill" : "buff"}
                  career={detail} operations={operations} busy={Boolean(busy)} api={api}
                  onChange={next => updateDraft({ ...draft, operations: next })} /> : <section className="form-section">
                <div className="section-heading"><h3>表与引用关系</h3><span>显式关系优先</span></div>
                <div className="relations">{summary?.relations.map(([from, field, to, note]) => <div key={from + field}>
                  <strong>{from}</strong><ArrowRight size={14} /><strong>{to}</strong><code>{field}</code><p>{note}</p>
                </div>)}</div>
                <h3 className="catalog-title">数据目录</h3>
                <table className="catalog"><thead><tr><th>源表 / 配置类</th><th>记录</th><th>面板能力</th></tr></thead><tbody>{summary?.tables.map(t => <tr key={t.key}>
                  <td>{t.file}<code>{t.className}</code></td><td>{t.rows ?? "缺失"}</td><td>{t.editable ? "模块编辑" : "只读研究"}</td>
                </tr>)}</tbody></table>
              </section>}
          </div>
        </> : <div className="empty"><FileSpreadsheet size={38} strokeWidth={1} /><h2>{busy ? "正在读取配置" : "从一个职业开始"}</h2>
          <p>读取本机配置，集中编辑跨表字段，再核对写入差异。</p>
          {!summary?.loaded && <button onClick={() => setDirectoryOpen(true)}>设置数据目录</button>}</div>}
      </main>
      <aside className="inspector" aria-label="差异检查器">
        <div className="inspector-title"><ShieldCheck size={17} /><h3>检查器</h3></div>
        <div className="inspector-scroll">
          <section><div className="section-heading"><h4>{result ? writtenToTarget ? "已写入草稿" : "已写入其他目标" : "待写入草稿"}</h4><span>{count} 项</span></div>
            {receipt && <p className="hint">{result ? "这份草稿已写入；保存与导表状态请在 Excel 中核对。" : "已有上次写入记录。新草稿须重新审核；源表继续编辑前请保存、导表并重读。"}{`上次目标：${receipt.mode === "source" ? "源工作簿" : "隔离副本"}。`}</p>}
            {!count && <p className="hint">修改字段后，差异会显示在这里。</p>}
            {draft.clone && <div className="diff"><strong>复制职业基础</strong><code>{selected} → {draft.targetId || "待填写 ID"}</code></div>}
            {changes.map(c => <div className="diff" key={c.section + c.field.name}>
              <span>{c.section}</span><strong>{c.field.label || c.field.name}</strong>
              <del>{c.field.values.join(" | ") || "（空）"}</del><ins>{c.after.join(" | ") || "（空）"}</ins>
            </div>)}
            {operations.map(o => <div className="diff" key={`${o.table}:${o.targetId}`}>
              <strong>{o.title} · {o.targetId}</strong>
              {o.sourceId !== o.targetId && <code>复制 {o.sourceId} → {o.targetId}</code>}
              {Object.entries(o.edits).map(([name, values]) => <div key={name}><code>{name}</code>
                <ins>{values.join(" | ") || "（空）"}</ins></div>)}
            </div>)}
            {count > 0 && <button className="reset" disabled={Boolean(busy)} onClick={() => updateDraft(emptyDraft(selected))}><RotateCcw size={13} />{receipt ? "恢复快照草稿" : "撤销当前职业草稿"}</button>}
            {receipt && <p className="hint">恢复草稿不会撤销 Excel 中的改动。</p>}
          </section>
          <section><h4>关联表</h4>{detail?.sections.map(s => <div className="source-row" key={s.key}><FileSpreadsheet size={14} /><span>{s.title}</span><code>{detail.id}</code></div>)}
            {detail?.creation.map(c => <div className="source-row" key={c["CreateRole.id"]}><FileSpreadsheet size={14} /><span>创角展示 · 只读</span><code>{c["CreateRole.id"]}</code></div>)}
            {detail && !detail.creation.length && <p className="hint">该分支没有直接创角记录。</p>}
          </section>
          <section><h4>写入目标</h4><label className="mode-option"><input type="radio" name="mode" value="copy" checked={mode === "copy"} onChange={() => { revision.current += 1; setMode("copy"); setReview(null); }} />隔离工作簿副本</label>
            <label className="mode-option"><input type="radio" name="mode" value="source" checked={mode === "source"} onChange={() => { revision.current += 1; setMode("source"); setReview(null); }} />源工作簿</label>
            <p className={mode === "source" ? "warning" : "hint"}>{mode === "source" ? "将修改源 Excel 的打开会话；写入后仍须人工保存与导表。" : "复制需要修改的工作簿到临时目录，在 Excel 中试写。"}</p>
          </section>
          {summary?.missing?.length ? <section><h4>缺失数据</h4><p className="warning">{summary.missing.join("、")}</p></section> : null}
        </div>
      </aside>
    </div>
    {error && <div className="feedback error" role="alert"><X size={17} /><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError("")}><X size={14} /></button></div>}
    {result && <div className="feedback success" role="status"><Check size={17} /><div>上次写入回执：{result.message}{result.paths.map(p => <code key={p}>{p}</code>)}</div></div>}
    <footer><div className="footer-status" role="status">{busy ? <LoaderCircle size={15} className="spinner" /> : <span className="status-dot" />}
      <span>{busy || (result ? writtenToTarget ? "已写入 Excel · 请核对保存与导表状态" : "已写入其他目标 · 当前目标待审核" : count ? `当前职业 ${count} 项${receipt ? "新" : ""}草稿 · 尚未写入` : receipt ? "草稿已恢复快照 · Excel 写入仍保留" : "就绪 · 可编辑草稿")}</span></div>
      <button className="primary" disabled={!detail || !count || Boolean(busy) || writtenToTarget || (draft.clone && !draft.targetId)} onClick={prepare}>
        检查写入差异<ArrowRight size={16} /></button>
    </footer>
    <dialog ref={dialog} aria-labelledby="review-title" onCancel={e => { if (busy) e.preventDefault(); }}>
      <div className="dialog-header"><h2 id="review-title">{review?.mode === "source" ? "审核源工作簿写入" : "审核隔离副本试写"}</h2>
        <button aria-label="关闭审核" disabled={Boolean(busy)} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <div className="dialog-body">
        <p>逐表核对以下变更。Excel 中已有的未保存改动若与基线冲突，将停止写入。</p>
        {review?.warnings.map(w => <p className="warning" key={w}>{w}</p>)}
        {review?.plans.map(p => <section className="review-plan" key={`${p.path}:${p.targetId}`}>
          <h3>{p.path.split(/[\\/]/).pop()} <span>{p.sheet} · 源行 {p.row}</span></h3><code className="file-path">{p.path}</code>
          {p.clone && <p>完整复制源行 <code>{p.sourceId}</code> 为新 ID <code>{p.targetId}</code>，保留未编辑列和格式。</p>}
          {p.changes.map((c, i) => <div className="review-change" key={i}><code>{c.member}{c.slot ? ` [${c.slot}]` : ""}</code><del>{c.before || "（空）"}</del><ArrowRight size={13} /><ins>{c.after || "（空）"}</ins></div>)}
        </section>)}
      </div>
      <div className="dialog-footer"><span>{busy || "写入后标红 · 保持未保存 · 不自动导表"}</span><button className="primary" disabled={Boolean(busy) || !review} onClick={commit}>
        {busy ? <LoaderCircle size={15} className="spinner" /> : <FileSpreadsheet size={15} />}{review?.mode === "source" ? "确认写入源 Excel" : "确认试写副本"}</button></div>
    </dialog>
  </div>;
}
