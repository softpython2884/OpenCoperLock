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
import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import { Eye, Code2, Pencil, Save, Loader2, Play } from 'lucide-react';
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
        {editing ? (
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
