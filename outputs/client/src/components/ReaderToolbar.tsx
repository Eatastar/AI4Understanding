import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowLeft, BookMarked, BookOpenText, ChevronLeft, ChevronRight, Columns2, Crop, Eye, FolderOpen, Keyboard, Maximize2, Minus, PanelLeft, Plus, RotateCcw, Settings2, SlidersHorizontal, X } from 'lucide-react';
import type { ReaderAppearance } from '../domain/reader';
import { ReaderEngineOptions } from './ReaderEngineOptions';
import { readReaderOptions } from '../adapters/reader-policy';
import { LanguageSelector } from './LanguageSelector';
import { ReaderAppearancePanel } from './ReaderAppearancePanel';
import { NativeSelect } from './NativeSelect';
import type { DocumentContextMode } from '../domain/document-context';
import { ShortcutButton, TranslationButton, useTranslation } from './Translation';
import { DEFAULT_FIGURE_SHORTCUT, shortcutAriaLabel, shortcutLabel } from '../domain/translation';
import { isEbookKind, type DocumentKind } from '../domain/types';
import type { EbookTypography } from '../domain/ebook';

interface Props {
  typography?: EbookTypography; onTypography?: (value: EbookTypography) => void;
  figureSelecting?: boolean; figureBusy?: boolean; onToggleFigure?: () => void;
  onReturnFromLink?: () => void;
  projectReturn?: { title: string; onReturn: () => void };
  name: string; kind: DocumentKind; pageCount: number; pageIndex: number; pageInput: string;
  pageInputRef: RefObject<HTMLInputElement | null>; onPageInput: (value: string) => void; onCommitPage: () => void; onPage: (index: number) => void;
  zoom: number; onZoom: (value: number) => void; view: 'original' | 'text'; onView: (value: 'original' | 'text') => void;
  layout: 'paged' | 'continuous'; onLayout: (value: 'paged' | 'continuous') => void;
  appearance: ReaderAppearance; onAppearance: (value: ReaderAppearance) => void; saved: boolean;
  compareOriginal: boolean; onCompareOriginal: () => void;
  navigationOpen: boolean; onToggleNavigation: () => void; focused: boolean; onToggleFocus: () => void; onClose: () => void;
  modelLabel?: string; onOpenModelSettings?: () => void; onBackup?: () => void; onOpenFile?: () => void;
  onOpenKnowledge?: () => void;
  onOpenWiki?: () => void;
  onOpenExperiment?: () => void;
  contextMode: DocumentContextMode; onContextMode: (value: DocumentContextMode) => void; relevantContext: boolean;
}

export function ReaderToolbar(props: Props) {
  useLocale();
  const translation = useTranslation();
  const [engine,setEngine]=useState(readReaderOptions);
  const shortcut = translation?.preferences.figureShortcut || DEFAULT_FIGURE_SHORTCUT;
  const ebook = isEbookKind(props.kind);
  const { typography, onTypography } = props;
  const [panel, setPanel] = useState<'reading' | 'typography' | null>(null);
  const panelRef = useRef<HTMLDivElement>(null), settingsTrigger = useRef<HTMLButtonElement>(null), typographyTrigger = useRef<HTMLButtonElement>(null);
  const settingsId = useId(), typographyId = useId();
  const trigger = panel === 'typography' ? typographyTrigger : settingsTrigger;
  const closePanel = () => { setPanel(null); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!panel) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPanel(null);
    };
    const closeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); setPanel(null); trigger.current?.focus({ preventScroll: true });
    };
    panelRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeKey);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('focusin', closeOutside); document.removeEventListener('keydown', closeKey); };
  }, [panel, trigger]);
  const mode = ebook ? t('章节') : props.view === 'text' ? t("文本") : props.layout === 'continuous' ? t("连续") : t("单页");
  const zoomControls = <>
    <button type="button" className="document-icon-button" aria-label={t(ebook ? '缩小电子书' : '缩小 PDF')} disabled={props.zoom <= .5} onClick={() => props.onZoom(props.zoom - .25)}><Minus size={15} /></button>
    <button type="button" className="document-fit-button" title={t(ebook ? '恢复 100% 缩放' : '恢复适合宽度')} aria-label={t(ebook ? '恢复 100% 缩放' : '恢复适合宽度')} onClick={() => props.onZoom(1)}>
      {props.zoom === 1 && !ebook ? <><span className="document-fit-label">{t("适合宽度")}</span><span className="document-fit-compact">100%</span></> : `${Math.round(props.zoom * 100)}%`}
    </button>
    <button type="button" className="document-icon-button" aria-label={t(ebook ? '放大电子书' : '放大 PDF')} disabled={props.zoom >= 2.5} onClick={() => props.onZoom(props.zoom + .25)}><Plus size={15} /></button>
  </>;
  const figureInToolbar = props.focused || !ebook;
  const figureControl = props.view === 'original' && props.onToggleFigure && (
    <button type="button" className={figureInToolbar ? 'reader-figure-button' : 'document-tool-button'} disabled={props.figureBusy} aria-pressed={props.figureSelecting}
      aria-label={t(props.figureSelecting ? '取消框选图片' : '框选图片提问')} aria-keyshortcuts={shortcutAriaLabel(shortcut)}
      title={`${t(props.figureSelecting ? '取消框选图片' : '框选整图，再圈出疑问')} · ${shortcutLabel(shortcut)}`}
      onClick={() => { if (!figureInToolbar) closePanel(); props.onToggleFigure?.(); }}>
      <Crop size={15} /><span>{t(props.figureSelecting ? '取消框选' : figureInToolbar ? '框选图片' : '框选图片提问')}</span>
    </button>
  );
  return <div className="reader-toolbar-region">
    <header className="reader-toolbar" aria-label={t("阅读工具栏")} data-testid="reader-toolbar">
      <div className="reader-toolbar-document">
        {props.focused && props.projectReturn && <button type="button" className="document-tool-button reader-project-return"
          aria-label={t('返回项目：{0}', [props.projectReturn.title])} title={t('返回项目：{0}', [props.projectReturn.title])} onClick={props.projectReturn.onReturn}>
          <ArrowLeft size={15} /><span>{props.projectReturn.title}</span>
        </button>}
        {props.onOpenFile && <button type="button" className="document-icon-button" aria-label={t("打开 PDF / 电子书")} title={t("打开 PDF / 电子书")} onClick={props.onOpenFile}><FolderOpen size={18} /></button>}
        <button type="button" className="document-icon-button" aria-label={t("文档导航")} title={t("目录、搜索与批注")} aria-expanded={props.navigationOpen} onClick={props.onToggleNavigation}><PanelLeft size={18} /></button>
        <div className="reader-toolbar-title" title={`${props.name} · ${mode} · ${props.relevantContext ? t('按需引用') : t('全文')}`}><strong>{props.name}</strong><span className="reader-mode-label">{mode} · {props.relevantContext ? t('按需引用') : t('全文')}</span></div>
      </div>
      <div className="reader-toolbar-position">
        <div className="document-page-navigation">
          {props.onReturnFromLink && <button type="button" className="document-icon-button" aria-label={t('返回跳转前位置')} title={t('返回跳转前位置')} onClick={props.onReturnFromLink}><ArrowLeft size={16} /></button>}
          <button type="button" className="document-icon-button" aria-label={t(ebook ? '上一章' : '上一页')} disabled={props.pageIndex <= 0} onClick={() => props.onPage(props.pageIndex - 1)}><ChevronLeft size={17} /></button>
          <label><input ref={props.pageInputRef} aria-label={t(ebook ? '章节编号' : '文档页码')} type="text" inputMode="numeric" value={props.pageInput} onChange={event => props.onPageInput(event.target.value)} onBlur={props.onCommitPage} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /><span> / {props.pageCount}</span></label>
          <button type="button" className="document-icon-button" aria-label={t(ebook ? '下一章' : '下一页')} disabled={props.pageIndex >= props.pageCount - 1} onClick={() => props.onPage(props.pageIndex + 1)}><ChevronRight size={17} /></button>
        </div>
        {(ebook || props.kind === 'pdf' && props.view === 'original') && <div className="document-zoom-controls">{zoomControls}</div>}
      </div>
      <div className="reader-toolbar-actions">
        {ebook && typography && onTypography && <button ref={typographyTrigger} type="button" className="document-tool-button reader-typography-trigger" aria-label={t('电子书排版')} title={t('电子书排版')} aria-expanded={panel === 'typography'} aria-controls={typographyId} onClick={() => setPanel(value => value === 'typography' ? null : 'typography')}><span aria-hidden="true" className="reader-typography-icon">Aa</span><span className="reader-typography-label">{t('排版')}</span></button>}
        <TranslationButton />
        {figureInToolbar && figureControl}
        {props.focused && props.onOpenWiki && <button type="button" className="document-tool-button reader-wiki-trigger" aria-label={t('个人知识库')} title={t('个人知识库')} onClick={props.onOpenWiki}>
          <BookOpenText size={17} /><span>{t('个人知识库')}</span>
        </button>}
        {props.focused && props.onOpenKnowledge && <button type="button" className="document-icon-button" aria-label={t("知识卡片")} title={t("知识卡片")} aria-haspopup="dialog" onClick={props.onOpenKnowledge}><BookMarked size={17} /></button>}
        {props.focused && <ShortcutButton />}
        <button ref={settingsTrigger} type="button" className="document-icon-button" aria-label={t("阅读设置")} title={t("阅读模式、配色与更多")} aria-controls={settingsId} aria-expanded={panel === 'reading'} onClick={() => setPanel(value => value === 'reading' ? null : 'reading')}><SlidersHorizontal size={18} /></button>
        <button type="button" className="document-icon-button" aria-label={props.focused ? t("显示聊天") : t("专注阅读")} title={props.focused ? t("显示聊天") : t("专注阅读")} onClick={props.onToggleFocus}>{props.focused ? <Columns2 size={18} /> : <Maximize2 size={18} />}</button>
        <button type="button" className="document-icon-button" aria-label={t(props.focused ? '返回工作台' : '关闭文档阅读')} title={t(props.focused ? '返回工作台' : '关闭文档阅读')} onClick={props.onClose}><X size={19} /></button>
      </div>
    </header>
    {panel === 'typography' && ebook && typography && onTypography && <div ref={panelRef} id={typographyId} role="dialog" aria-label={t('电子书排版')} className="reader-settings ebook-typography-settings">
      <header><strong>{t('电子书排版')}</strong><button type="button" className="document-icon-button" aria-label={t('关闭排版设置')} onClick={closePanel}><X size={18} /></button></header>
      {([
        ['fontSize', '字号', 12, 36, 1, ' px'], ['lineHeight', '行距', 1.2, 2.6, .1, '×'], ['width', '正文宽度', 400, 1200, 40, ' px'],
      ] as const).map(([key, label, min, max, step, unit]) => <label className="reader-setting-row" key={key}>
        <span>{t(label)}</span><input type="range" aria-label={t(label)} min={min} max={max} step={step} value={typography[key]} onChange={event => onTypography({ ...typography, [key]: Number(event.target.value) })} /><output>{Math.round(typography[key] * 10) / 10}{unit}</output>
      </label>)}
      <p className="reader-settings-help">{t('按书记住排版。双指、Ctrl+滚轮或加减按钮只改变显示倍率，保持换行。')}</p>
    </div>}
    {panel === 'reading' && <div ref={panelRef} id={settingsId} role="dialog" aria-label={t("阅读设置")} className="reader-settings" data-testid="reader-settings">
      <header><div><strong>{t("阅读设置")}</strong><small title={props.name}>{props.name}</small></div><button type="button" className="document-icon-button" aria-label={t("关闭阅读设置")} onClick={closePanel}><X size={18} /></button></header>
      {props.kind === 'pdf' && <div className="reader-setting-row"><span>{t("显示")}</span><div className="document-view-switch" role="group" aria-label={t("文档显示方式")}><button type="button" aria-pressed={props.view === 'original'} onClick={() => props.onView('original')}>{t("PDF 原排版")}</button><button type="button" aria-pressed={props.view === 'text'} onClick={() => props.onView('text')}>{t("可批注文本")}</button></div></div>}
      {props.kind === 'pdf' && props.view === 'original' && <>
        <div className="reader-setting-row"><span>{t("翻页")}</span><div className="document-view-switch" role="group" aria-label={t("翻页方式")}><button type="button" aria-pressed={props.layout === 'continuous'} onClick={() => props.onLayout('continuous')}>{t("连续滚动")}</button><button type="button" aria-pressed={props.layout === 'paged'} onClick={() => props.onLayout('paged')}>{t("单页阅读")}</button></div></div>
      </>}
      <ReaderAppearancePanel kind={props.kind} appearance={props.appearance} onChange={props.onAppearance} saved={props.saved} />
      {props.onOpenExperiment && <button type="button" className="document-tool-button" onClick={() => { closePanel(); props.onOpenExperiment?.(); }}><BookOpenText size={15} />{t('论文对照实验')}</button>}
      <div className="reader-setting-actions"><button type="button" className="document-tool-button" aria-pressed={props.compareOriginal} disabled={props.appearance.preset === 'original'} onClick={props.onCompareOriginal}><Eye size={14} />{t("原色对照")}</button>
        {!figureInToolbar && figureControl}
        {!props.focused && translation && <button type="button" className="document-tool-button" onClick={() => { closePanel(); translation.openShortcuts(); }}><Keyboard size={14} />{t('快捷键')}</button>}
        {props.onBackup && <button type="button" className="document-tool-button" onClick={() => { closePanel(); props.onBackup?.(); }}><RotateCcw size={14} />{t("备份与恢复")}</button>}
      </div>
      {props.onOpenModelSettings && <button type="button" className="reader-model-settings" onClick={() => { setPanel(null); props.onOpenModelSettings?.(); }}><Settings2 size={15} /><span>{t("模型与设置")}</span><small>{props.modelLabel}</small></button>}
      <details className="reader-settings-more">
        <summary>{t("更多设置")}</summary>
        <div className="reader-setting-row"><span>{t("界面语言")}</span><LanguageSelector /></div>
        <label className="reader-setting-row reader-context-setting"><span>{t("AI 资料范围")}</span><NativeSelect wrapperClassName="reader-context-select" aria-label={t("AI 资料范围")} value={props.contextMode} onChange={event => props.onContextMode(event.target.value as DocumentContextMode)}><option value="auto">{t("自动：小文件全文，大文件按需引用")}</option><option value="relevant">{t("按需引用")}</option><option value="full">{t("全文")}</option></NativeSelect></label>
        <ReaderEngineOptions options={engine} onChange={setEngine}/>
        {engine.enabled?<p className="reader-settings-help">{t('自动模式在预算内优先使用全文。长文献使用选区、邻段和相关原文。')}</p>:<><p className="reader-settings-help" role="status">{props.relevantContext ? t("当前文件：按需引用，发送选段、所在页和相关片段；不发送全文。") : t("当前文件：全文，发送全部提取文字；扫描图片暂不识别。")}</p>
        <p className="reader-settings-help">{t("自动模式：超过 25 MB、300 页或 12 万字符时按需引用，每份最多引用 2.4 万字符。全文模式仍受模型容量限制。")}</p></>}
      </details>
      <footer><span>{__APP_VERSION__} · {__APP_BUILD__}</span></footer>
    </div>}
  </div>;
}
