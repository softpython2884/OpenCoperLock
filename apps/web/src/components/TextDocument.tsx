'use client';

/**
 * In-app document surface for text-like files. Renders several ways:
 *   - Markdown (.md …)  → formatted preview (GFM + syntax-highlighted code fences).
 *   - HTML (.html …)    → rendered in a sandboxed <iframe> (isolated, opaque origin — it can
 *                         never reach your session/cookies). Page JavaScript is OFF by default
 *                         and toggled on demand (sandbox="allow-scripts", no allow-same-origin).
 *   - Code / text       → syntax-highlighted, read-only.
 *   - Edit mode         → a plain monospace editor with Save, when the file is editable.
 *
 * Renderable files (Markdown / HTML) get a Preview/Source toggle. Saving is delegated to
 * `onSave` (the Drive page re-uploads server files as a new version, or re-encrypts and
 * replaces Zero-Knowledge files).
 */
import { useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import {
  Eye,
  Code2,
  Pencil,
  Save,
  Loader2,
  Play,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Link2,
  Columns2,
} from 'lucide-react';
import { codeLanguage, isHtml, isMarkdown } from '@/lib/fileType';
import { useT } from '@/lib/i18n';
import { confirm, toast } from '@/components/ui/overlays';

// Above this size we skip highlighting (and Markdown parsing) to keep the UI responsive.
const HIGHLIGHT_LIMIT = 200_000;

export function TextDocument({
  name,
  mime,
  initialText,
  editable,
  onSave,
}: {
  name: string;
  mime?: string;
  initialText: string;
  editable?: boolean;
  onSave?: (text: string) => Promise<void>;
}) {
  const { t } = useT();
  const md = isMarkdown(name, mime);
  const html = isHtml(name, mime);
  const renderable = md || html;

  const [text, setText] = useState(initialText);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'preview' | 'source'>(renderable ? 'preview' : 'source');
  const [jsEnabled, setJsEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = text !== initialText;

  async function save() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(text);
      setEditing(false);
      toast(t('viewer.saved'), 'success');
    } catch {
      toast(t('viewer.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function cancelEdit() {
    if (dirty && !(await confirm({ title: t('viewer.discard'), danger: true, confirmLabel: t('common.confirm') }))) return;
    setText(initialText);
    setEditing(false);
  }

  const showPreview = renderable && mode === 'preview' && !editing;

  return (
    <div className="flex h-full w-full max-w-5xl flex-col self-stretch overflow-hidden rounded-lg border border-white/10 bg-ink-900">
      {/* Mini toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          {renderable && !editing && (
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              <button
                className={`flex items-center gap-1 rounded-md px-2 py-1 ${mode === 'preview' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                onClick={() => setMode('preview')}
              >
                <Eye size={13} /> {t('viewer.preview')}
              </button>
              <button
                className={`flex items-center gap-1 rounded-md px-2 py-1 ${mode === 'source' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                onClick={() => setMode('source')}
              >
                <Code2 size={13} /> {t('viewer.source')}
              </button>
            </div>
          )}
          {html && showPreview && (
            <button
              onClick={() => setJsEnabled((v) => !v)}
              title={jsEnabled ? t('viewer.jsOnTitle') : t('viewer.jsOffTitle')}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                jsEnabled
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                  : 'border-white/10 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Play size={12} /> {t('viewer.runJs')}
            </button>
          )}
        </div>
        {editable && onSave && (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={cancelEdit} disabled={saving}>
                  {t('common.cancel')}
                </button>
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={save} disabled={saving || !dirty}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {saving ? t('viewer.saving') : t('viewer.save')}
                </button>
              </>
            ) : (
              <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setEditing(true)}>
                <Pencil size={13} /> {t('viewer.edit')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {editing && md ? (
          <MarkdownEditor value={text} onChange={setText} />
        ) : editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-200 outline-none"
          />
        ) : showPreview && md ? (
          <div className="md-prose p-5">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={text.length < HIGHLIGHT_LIMIT ? [rehypeHighlight] : []}>
              {text}
            </Markdown>
          </div>
        ) : showPreview && html ? (
          <iframe
            // Re-mount on JS toggle so the sandbox flags actually change. allow-scripts WITHOUT
            // allow-same-origin gives the page an opaque origin: it can run but can't touch the
            // app's cookies, storage or session.
            key={jsEnabled ? 'js' : 'nojs'}
            title={name}
            srcDoc={text}
            sandbox={jsEnabled ? 'allow-scripts' : ''}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <CodeBlock name={name} text={text} highlight={!md} />
        )}
      </div>
    </div>
  );
}

/**
 * Markdown editor: a source textarea with a formatting toolbar and a live preview beside it that
 * re-renders as you type — the "what you type is what you get" feel, without a heavy WYSIWYG engine.
 */
function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(true);

  /** Wrap the current selection with `before`/`after` (e.g. **bold**). */
  function surround(before: string, after = before) {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = e + before.length;
    });
  }
  /** Prefix every line touched by the selection (headings, lists, quotes). */
  function prefixLines(prefix: string) {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e);
    const prefixed = block.split('\n').map((l) => prefix + l).join('\n');
    const next = value.slice(0, lineStart) + prefixed + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = lineStart;
      ta.selectionEnd = e + (prefixed.length - block.length);
    });
  }

  const tools: { icon: typeof Bold; label: string; run: () => void }[] = [
    { icon: Bold, label: t('mdedit.bold'), run: () => surround('**') },
    { icon: Italic, label: t('mdedit.italic'), run: () => surround('*') },
    { icon: Strikethrough, label: t('mdedit.strike'), run: () => surround('~~') },
    { icon: Code, label: t('mdedit.code'), run: () => surround('`') },
    { icon: Heading1, label: t('mdedit.h1'), run: () => prefixLines('# ') },
    { icon: Heading2, label: t('mdedit.h2'), run: () => prefixLines('## ') },
    { icon: List, label: t('mdedit.bullet'), run: () => prefixLines('- ') },
    { icon: ListOrdered, label: t('mdedit.number'), run: () => prefixLines('1. ') },
    { icon: ListChecks, label: t('mdedit.check'), run: () => prefixLines('- [ ] ') },
    { icon: Quote, label: t('mdedit.quote'), run: () => prefixLines('> ') },
    { icon: Link2, label: t('mdedit.link'), run: () => surround('[', '](https://)') },
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      surround('**');
    } else if (k === 'i') {
      e.preventDefault();
      surround('*');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-white/10 px-2 py-1.5">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            onClick={tool.run}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
          >
            <tool.icon size={15} />
          </button>
        ))}
        <div className="ml-auto">
          <button
            type="button"
            title={t('mdedit.togglePreview')}
            onClick={() => setPreview((p) => !p)}
            className={`rounded-md p-1.5 transition hover:bg-white/5 ${preview ? 'text-violet-300' : 'text-zinc-400 hover:text-zinc-100'}`}
          >
            <Columns2 size={15} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className={`min-h-0 w-full flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-200 outline-none ${preview ? 'md:w-1/2' : ''}`}
        />
        {preview && (
          <div className="md-prose min-h-0 flex-1 overflow-auto border-t border-white/10 p-4 md:w-1/2 md:border-l md:border-t-0">
            {value.length < HIGHLIGHT_LIMIT ? (
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {value}
              </Markdown>
            ) : (
              <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only, syntax-highlighted code/text block. */
function CodeBlock({ name, text, highlight }: { name: string; text: string; highlight: boolean }) {
  const htmlOut = useMemo(() => {
    if (!highlight || text.length > HIGHLIGHT_LIMIT) return null;
    try {
      const lang = codeLanguage(name);
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(text, { language: lang }).value;
      return hljs.highlightAuto(text).value;
    } catch {
      return null;
    }
  }, [name, text, highlight]);

  return (
    <pre className="h-full w-full overflow-auto p-4 text-xs leading-relaxed">
      {htmlOut ? (
        <code className="hljs bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: htmlOut }} />
      ) : (
        <code className="text-zinc-300">{text}</code>
      )}
    </pre>
  );
}
