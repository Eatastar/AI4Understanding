import { useId, useMemo, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Bold, Heading2, Italic, Link2, List, Redo2, Sigma, Undo2 } from 'lucide-react';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { NativeSelect } from '../components/NativeSelect';
import { t } from '../i18n/locale';
import { wikiHeadings } from './wiki-document';
import { previewWikiFormula } from './wiki-formula';
import type { FormulaEdit } from './wiki-editor';
import { wikiRelations, type WikiRecord, type WikiRelation } from './wiki-types';

export const relationLabels: Record<WikiRelation, string> = {
  related: '相关', depends_on: '依赖', explains: '解释', extends: '延伸',
};
export interface EntryLinkInput { pageId: string; label: string; relation: WikiRelation; toBlockId?: string }

export function WikiToolbar({ editor, onFormula, onLink, onAI }: {
  editor: Editor; onAI: ()=>void; onFormula: (kind: FormulaEdit['kind']) => void; onLink: () => void;
}) {
  const state = useEditorState({
    editor, selector: ({ editor }) => ({
      bold: editor.isActive('bold'), italic: editor.isActive('italic'), heading: editor.isActive('heading', { level: 2 }),
      list: editor.isActive('bulletList'), undo: editor.can().undo(), redo: editor.can().redo(),
    }),
  });
  return <div className="wiki-editor-toolbar" role="group" aria-label={t('正文工具')} onMouseDown={event => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  }}>
    <div>
      <button type="button" aria-label={t('二级标题')} title={t('二级标题')} aria-pressed={state.heading} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></button>
      <button type="button" aria-label={t('粗体')} title={t('粗体')} aria-pressed={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></button>
      <button type="button" aria-label={t('斜体')} title={t('斜体')} aria-pressed={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></button>
      <button type="button" aria-label={t('项目符号列表')} title={t('项目符号列表')} aria-pressed={state.list} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17} /></button>
    </div>
    <div>
      <button type="button" onClick={onAI}>{t('AI 辅助编辑')}</button>
      <button type="button" onClick={onLink}><Link2 size={15} />{t('条目链接')}</button>
      <button type="button" onClick={() => onFormula('inline')}><Sigma size={15} />{t('行内公式')}</button>
      <button type="button" onClick={() => onFormula('block')}><Sigma size={15} />{t('块级公式')}</button>
    </div>
    <div>
      <button type="button" aria-label={t('撤销')} title={t('撤销')} disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={17} /></button>
      <button type="button" aria-label={t('重做')} title={t('重做')} disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={17} /></button>
    </div>
  </div>;
}

export function WikiFormulaForm({ formula, onCancel, onApply }: {
  formula: FormulaEdit; onCancel: () => void; onApply: (formula: FormulaEdit) => void;
}) {
  const [value, setValue] = useState(formula.latex);
  const errorId = useId();
  const latex = value.trim();
  const displayMode = formula.kind === 'block';
  const preview = useMemo(() => latex ? previewWikiFormula(latex, displayMode) : undefined, [latex, displayMode]);
  const valid = preview && 'html' in preview;
  const failure = preview && 'error' in preview ? preview : undefined;
  return <form className="wiki-insert-form" aria-label={t(formula.kind === 'inline' ? '行内公式' : '块级公式')}
    onSubmit={event => {
      event.preventDefault();
      if (valid) onApply({ ...formula, latex });
    }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onCancel(); } }}>
    <label className="wiki-field"><span>{t(formula.kind === 'inline' ? '行内公式' : '块级公式')}</span>
      <textarea autoFocus rows={2} value={value} placeholder="LaTeX" maxLength={100000} aria-invalid={Boolean(failure)}
        aria-describedby={failure ? errorId : undefined} onChange={event => setValue(event.target.value)} />
    </label>
    {valid && <div className="wiki-formula-preview" aria-label={t('公式预览')} dangerouslySetInnerHTML={{ __html: preview.html }} />}
    {failure && <p id={errorId} className="wiki-error wiki-formula-error" role="status">
      {failure.infinityHint ? t('若上标表示无穷大，请将 {0} 改为 {1}。', ['^\\inf', '^{\\infty}']) : t('公式无法渲染，请检查 LaTeX 语法。')}
      <small>{failure.error}</small>
    </p>}
    <div className="wiki-form-actions"><button type="button" className="wiki-action" onClick={onCancel}>{t('取消')}</button>
      <button type="submit" className="wiki-action wiki-action-primary" {...confirmShortcut} disabled={!valid}>{t(formula.pos === undefined ? '插入' : '保存')}</button></div>
  </form>;
}

export function WikiLinkForm({ records, currentId, onCancel, onApply }: {
  records: readonly WikiRecord[]; currentId?: string; onCancel: () => void; onApply: (input: EntryLinkInput) => void;
}) {
  const options = records.filter(record => record.page.id !== currentId);
  const [selected, setSelected] = useState('');
  const [toBlockId, setToBlockId] = useState('');
  const [relation, setRelation] = useState<WikiRelation>('related');
  const target = options.find(record => record.page.id === selected)?.page;
  const headings = useMemo(() => target ? wikiHeadings(target.body) : [], [target]);
  return <form className="wiki-insert-form" aria-label={t('插入条目链接')} onSubmit={event => {
    event.preventDefault();
    if (target) onApply({ pageId: target.id, label: target.title, relation, ...(toBlockId ? { toBlockId } : {}) });
  }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onCancel(); } }}>
    {!options.length ? <p className="wiki-muted">{t('再新建一个条目即可建立链接。')}</p> : <div className="wiki-link-fields">
      <label className="wiki-field"><span>{t('链接到条目')}</span>
        <NativeSelect autoFocus value={selected} onChange={event => { setSelected(event.target.value); setToBlockId(''); }}>
          <option value="">{t('选择条目')}</option>
          {options.map(({ page }) => <option value={page.id} key={page.id}>{page.title}</option>)}
        </NativeSelect>
      </label>
      <label className="wiki-field"><span>{t('联系')}</span>
        <NativeSelect value={relation} onChange={event => setRelation(event.target.value as WikiRelation)}>
          {wikiRelations.map(value => <option key={value} value={value}>{t(relationLabels[value])}</option>)}
        </NativeSelect>
      </label>
      {!!headings.length && <label className="wiki-field"><span>{t('跳到小节')}</span>
        <NativeSelect value={toBlockId} onChange={event => setToBlockId(event.target.value)}>
          <option value="">{t('条目开头')}</option>
          {headings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </NativeSelect>
      </label>}
    </div>}
    <div className="wiki-form-actions"><button type="button" className="wiki-action" onClick={onCancel}>{t('取消')}</button>
      <button type="submit" className="wiki-action wiki-action-primary" {...confirmShortcut} disabled={!target}>{t('插入链接')}</button></div>
  </form>;
}
