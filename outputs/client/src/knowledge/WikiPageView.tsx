import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { ArrowUpRight, Clock3, PenLine } from 'lucide-react';
import { confirmShortcut, confirmationScope } from '../hooks/confirmation-shortcut';
import { getLocale, t } from '../i18n/locale';
import type { Workspace } from '../domain/types';
import type { KnowledgeCard } from '../domain/knowledge';
import { FloatingReferencePanel } from './FloatingReferencePanel';
import { legacyReaderReferences } from './legacy-reader-adapter';
import { citedReferences, sourceCitation } from './wiki-document';
import { WIKI_REFERENCE_DRAG, wikiEditorExtensions, WikiNavigation, type FormulaEdit } from './wiki-editor';
import { pasteWikiMarkdown, restoreClipboardMath } from './wiki-markdown';
import { relationLabels, WikiFormulaForm, WikiLinkForm, WikiToolbar, type EntryLinkInput } from './WikiEditorForms';
import type { ReferenceItem, SourceCitation, WikiDraft, WikiLink, WikiPage, WikiRecord, WikiRepository, WikiRevision } from './wiki-types';

type EditorTool = { type: 'link' } | { type: 'formula'; formula: FormulaEdit };

export function wikiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return t(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, ''));
}

interface Props {
  entry?: WikiRecord;
  blockId?: string;
  records: readonly WikiRecord[];
  workspace: Workspace;
  cards: readonly KnowledgeCard[];
  repository: WikiRepository;
  flushRef: RefObject<(() => Promise<void>) | null>;
  onStore: (record: WikiRecord) => void;
  onOpenEntry: (id: string, blockId?: string) => void;
  onOpenCitation: (citation: SourceCitation) => void;
}
export function WikiPageView({ entry, blockId, records, workspace, cards, repository, flushRef, onStore, onOpenEntry, onOpenCitation }: Props) {
  const [page, setPage] = useState(entry?.page);
  const [editing, setEditing] = useState(!entry);
  const [title, setTitle] = useState(page?.title ?? '');
  const [domains, setDomains] = useState(page?.domains.join(', ') ?? '');
  const [understanding, setUnderstanding] = useState(page?.personalUnderstanding ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<EditorTool | null>(null);
  const [history, setHistory] = useState<WikiRevision[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [preview, setPreview] = useState<WikiPage>();
  const pageRef = useRef(page);
  const edits = useRef(0), checkpoint = useRef(0);
  const writing = useRef<Promise<void> | null>(null);
  const fields = useRef({ title, domains, understanding });
  fields.current = { title, domains, understanding };
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [extraSources, setExtraSources] = useState<ReadonlySet<string>>(() => new Set());
  const references = useMemo(() => editing ? legacyReaderReferences(workspace, cards, records) : [], [editing, workspace, cards, records]);
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const indexed = useMemo(() => new Map(records.map(record => [record.page.id, record])), [records]);
  const cited = useMemo(() => {
    const sources = page ? citedReferences(page.body).sources : new Set<string>();
    for (const id of extraSources) sources.add(id);
    return sources;
  }, [page, extraSources]);
  const markChanged = () => { edits.current++; setDirty(true); };
  const addCitation = (item: ReferenceItem) => setExtraSources(previous => previous.has(item.sourceId) ? previous : new Set([...previous, item.sourceId]));
  const [extensions] = useState(() => wikiEditorExtensions(formula => {
    if (editingRef.current) setTool({ type: 'formula', formula });
  }));
  const editor = useEditor({
    extensions,
    content: page?.body ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID() } }] },
    editable: editing,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'wiki-prose', 'aria-label': t('条目正文'),
        'data-placeholder': t('可直接粘贴含公式的 Markdown'), spellcheck: 'false',
      },
      handlePaste: pasteWikiMarkdown,
      transformPastedHTML: (html, view) => restoreClipboardMath(html, view.dom.ownerDocument),
      handleDrop(view, event) {
        const id = event.dataTransfer?.getData(WIKI_REFERENCE_DRAG);
        if (!id) return false;
        const item = referencesRef.current.find(item => item.id === id);
        const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (item && target && editingRef.current) {
          const node = view.state.schema.nodes.sourceCite.create(sourceCitation(item));
          view.dispatch(view.state.tr.replaceRangeWith(target.pos, target.pos, node).scrollIntoView());
          view.focus();
          addCitation(item);
        }
        event.preventDefault();
        return true;
      },
    },
    onUpdate: markChanged,
  }, []);
  useLayoutEffect(() => { if (editor?.isEditable !== editing) editor?.setEditable(editing, false); }, [editor, editing]);
  useEffect(() => {
    if (!editor || !blockId) return;
    const frame = requestAnimationFrame(() => {
      editor.state.doc.descendants((node, pos) => {
        if (node.attrs.blockId !== blockId) return;
        const element = editor.view.nodeDOM(pos);
        if (element instanceof HTMLElement) element.scrollIntoView({ block: 'center' });
        return false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, blockId]);

  const store = (record: WikiRecord) => {
    pageRef.current = record.page;
    setPage(record.page);
    onStore(record);
  };
  const persist = (force = false): Promise<void> => {
    if (writing.current) return writing.current;
    if (!editor || (edits.current === checkpoint.current && (!force || pageRef.current))) return Promise.resolve();
    const version = edits.current;
    const current = pageRef.current;
    const values = fields.current;
    const domains = [...new Set(values.domains.split(/[,，、\n]/u).map(name => name.trim()).filter(Boolean))];
    const draft: WikiDraft = {
      title: values.title.trim() || t('未命名条目'), domains, body: editor.getJSON(),
      ...(values.understanding.trim() ? { personalUnderstanding: values.understanding } : {}),
    };
    setError(''); setSaving(true);
    const done = repository.save({ id: current?.id, expectedRevision: current?.revision ?? 0, draft }).then(record => {
      store(record);
      checkpoint.current = version;
      if (edits.current === version) {
        setTitle(record.page.title);
        setDomains(record.page.domains.join(', '));
        setDirty(false);
      }
    }).catch(failure => { setError(wikiError(failure)); throw failure; }).finally(() => {
      writing.current = null;
      setSaving(false);
    });
    writing.current = done;
    return done;
  };
  const flush = async () => {
    while (writing.current || edits.current !== checkpoint.current) {
      if (!editor && !writing.current) throw new Error('条目编辑器尚未就绪。');
      await persist();
    }
  };
  const flushCurrent = useRef(flush);
  flushCurrent.current = flush;
  useLayoutEffect(() => {
    flushRef.current = () => flushCurrent.current();
    return () => { flushRef.current = null; };
  }, [flushRef]);

  const read = async () => {
    try { await persist(true); await flush(); setEditing(false); setTool(null); }
    catch { /* Keep the editor open with its save error. */ }
  };
  const chooseHistory = async () => {
    if (!page) return;
    if (history) { setHistory(null); return; }
    setHistoryBusy(true); setError('');
    try { setHistory(await repository.history(page.id)); }
    catch (failure) { setError(wikiError(failure)); }
    finally { setHistoryBusy(false); }
  };
  const readVersion = async (revision: number) => {
    if (!page || !editor) return;
    setHistoryBusy(true); setError('');
    try {
      const historical = await repository.revision({ id: page.id, revision });
      editor.commands.setContent(historical.body, { emitUpdate: false });
      setPreview(historical);
    } catch (failure) { setError(wikiError(failure)); }
    finally { setHistoryBusy(false); }
  };
  const exitPreview = () => {
    if (page && editor) editor.commands.setContent(page.body, { emitUpdate: false });
    setPreview(undefined);
  };
  const restore = async () => {
    if (!page || !preview || !editor) return;
    setHistoryBusy(true); setError('');
    try {
      const record = await repository.restore({ id: page.id, revision: preview.revision, expectedRevision: page.revision });
      editor.commands.setContent(record.page.body, { emitUpdate: false });
      store(record);
      setTitle(record.page.title); setDomains(record.page.domains.join(', ')); setUnderstanding(record.page.personalUnderstanding ?? '');
      setPreview(undefined); setHistory(null); setExtraSources(new Set());
    } catch (failure) { setError(wikiError(failure)); }
    finally { setHistoryBusy(false); }
  };

  const insertFormula = (formula: FormulaEdit) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    const { kind, latex, pos } = formula;
    const applied = kind === 'inline'
      ? (pos === undefined ? chain.insertInlineMath({ latex }) : chain.updateInlineMath({ latex, pos })).run()
      : (pos === undefined ? chain.insertBlockMath({ latex }) : chain.updateBlockMath({ latex, pos })).run();
    if (applied) setTool(null);
  };
  const insertInline = (node: JSONContent) => {
    if (!editor) return false;
    const end = editor.state.selection.$to;
    const position = end.parent.inlineContent ? end.pos : Selection.findFrom(end, 1, true)?.from;
    return editor.chain().focus().insertContentAt(position ?? end.pos,
      position === undefined ? { type: 'paragraph', content: [node] } : node).run();
  };
  const insertLink = (input: EntryLinkInput) => {
    if (insertInline({ type: 'wikiLink', attrs: { ...input, blockId: crypto.randomUUID() } })) setTool(null);
  };
  const insertCitation = (item: ReferenceItem) => {
    if (insertInline({ type: 'sourceCite', attrs: { ...sourceCitation(item) } })) addCitation(item);
  };
  const shown = preview ?? page;
  const outgoing = page ? indexed.get(page.id)?.links ?? [] : [];
  const incoming = useMemo(() => page ? records.flatMap(record => record.links.filter(link => link.toPageId === page.id && link.status === 'accepted')) : [], [page, records]);
  const links = (items: readonly WikiLink[], backlinks: boolean) => items.map(link => {
    const targetId = backlinks ? link.fromPageId : link.toPageId;
    const target = indexed.get(targetId)?.page;
    if (!target) return null;
    return <li key={link.id}><button type="button" className="wiki-text-link"
      onClick={() => onOpenEntry(targetId, backlinks ? link.fromBlockId : link.toBlockId)}>{target.title}<ArrowUpRight size={13} /></button>
      <small>{t(relationLabels[link.relation])}</small></li>;
  });
  return <section className="wiki-article wiki-column" data-editing={editing || undefined} {...confirmationScope} aria-label={t('知识库条目')}>
    <div className="wiki-page-actions">
      {editing ? <>
        <span role="status" className="wiki-muted">{t(saving ? '正在保存…' : dirty ? '有未保存的修改' : page ? '已保存' : '编辑模式')}</span>
        <button type="button" className="wiki-action" disabled={saving} onClick={() => void read()}>{t('阅读模式')}</button>
        <button type="button" className="wiki-action wiki-action-primary" {...confirmShortcut} disabled={!editor || saving || !!page && !dirty}
          onClick={() => void persist(true).catch(() => {})}>{t('保存条目')}</button>
      </> : <>
        {preview ? <button type="button" className="wiki-action" onClick={exitPreview} disabled={historyBusy}>{t('返回当前版本')}</button>
          : <button type="button" className="wiki-action" aria-expanded={history !== null} disabled={historyBusy || !page} onClick={() => void chooseHistory()}><Clock3 size={15} />{t('版本记录')}</button>}
        {preview ? <button type="button" className="wiki-action wiki-action-primary" {...confirmShortcut} disabled={historyBusy} onClick={() => void restore()}>{t('恢复此版本')}</button>
          : <button type="button" className="wiki-action wiki-action-primary" disabled={!editor} onClick={() => { setEditing(true); setHistory(null); }}><PenLine size={15} />{t('编辑模式')}</button>}
      </>}
    </div>
    {error && <p className="wiki-error" role="alert">{error}</p>}
    {preview && <p className="wiki-muted" role="status">{t('正在查看第 {0} 版', [preview.revision])}</p>}
    {history && !preview && <div className="wiki-history">
      {history.map(item => <div key={item.revision}><span>{t('第 {0} 版', [item.revision])} · <time>{new Date(item.updatedAt).toLocaleString(getLocale(), { hour12: false })}</time></span>
        {item.revision === page?.revision ? <small>{t('当前版本')}</small>
          : <button type="button" className="wiki-action" disabled={historyBusy} onClick={() => void readVersion(item.revision)}>{t('查看版本')}</button>}</div>)}
    </div>}
    {editing ? <div className="wiki-page-heading">
      <input aria-label={t('条目标题')} placeholder={t('未命名条目')} className="wiki-title-input" value={title} maxLength={240}
        onChange={event => { setTitle(event.target.value); markChanged(); }} />
      <label className="wiki-field wiki-domain-field"><span>{t('领域')}</span>
        <input aria-label={t('领域')} placeholder={t('用逗号分隔领域')} value={domains} maxLength={2591}
          onChange={event => { setDomains(event.target.value); markChanged(); }} />
      </label>
    </div> : <header className="wiki-page-heading"><h1>{shown?.title}</h1>
      {!!shown?.domains.length && <div className="wiki-domain-labels">{shown.domains.map(domain => <span key={domain}>{domain}</span>)}</div>}
    </header>}
    {editing && editor && <WikiToolbar editor={editor} onLink={() => setTool({ type: 'link' })}
      onFormula={kind => setTool({ type: 'formula', formula: { kind, latex: '' } })} />}
    {editing && tool?.type === 'formula' && <WikiFormulaForm key={tool.formula.kind + ':' + tool.formula.pos} formula={tool.formula} onCancel={() => setTool(null)} onApply={insertFormula} />}
    {editing && tool?.type === 'link' && <WikiLinkForm records={records} currentId={page?.id} onCancel={() => setTool(null)} onApply={insertLink} />}
    <WikiNavigation.Provider value={{ records: indexed, openEntry: onOpenEntry, openCitation: onOpenCitation }}>
      <EditorContent editor={editor} className="wiki-editor-content" />
    </WikiNavigation.Provider>
    <details className="wiki-article-section" open={editing || undefined}>
      <summary>{t('我的理解')}</summary>
      {editing ? <textarea className="wiki-understanding" rows={4} aria-label={t('我的理解')} placeholder={t('写下你的批注…')}
        value={understanding} onChange={event => { setUnderstanding(event.target.value); markChanged(); }} />
        : <p className="wiki-understanding-text">{shown?.personalUnderstanding || t('还没有写下个人理解。')}</p>}
    </details>
    <details className="wiki-article-section">
      <summary>{t('知识联系 / 反向引用')}</summary>
      {outgoing.length > 0 && <><h3>{t('知识联系')}</h3><ul>{links(outgoing, false)}</ul></>}
      {incoming.length > 0 && <><h3>{t('反向引用')}</h3><ul>{links(incoming, true)}</ul></>}
      {!outgoing.length && !incoming.length && <p className="wiki-muted">{t('还没有条目链接。')}</p>}
    </details>
    {editing && <FloatingReferencePanel items={references} pageId={page?.id} title={title}
      citedSources={cited} onInsert={insertCitation} />}
  </section>;
}
