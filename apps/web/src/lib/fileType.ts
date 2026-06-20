/**
 * Maps a file to a coloured icon for the Drive UI. Same flat line-icon design language
 * throughout, differentiated only by a tint and a type-appropriate glyph — a PDF reads red,
 * a Word document blue, a spreadsheet green, and so on, so files are scannable at a glance.
 */
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

export interface FileVisual {
  Icon: LucideIcon;
  /** Tailwind text-colour class for the glyph. */
  color: string;
  /** Tailwind background tint for grid badges. */
  bg: string;
  /** Short human label, e.g. "PDF", "Word". */
  label: string;
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

const BY_EXT: Record<string, FileVisual> = {
  pdf: { Icon: FileText, color: 'text-red-400', bg: 'bg-red-500/10', label: 'PDF' },

  doc: { Icon: FileType, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Word' },
  docx: { Icon: FileType, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Word' },
  rtf: { Icon: FileType, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Document' },
  odt: { Icon: FileType, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Document' },

  xls: { Icon: FileSpreadsheet, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Excel' },
  xlsx: { Icon: FileSpreadsheet, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Excel' },
  csv: { Icon: FileSpreadsheet, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'CSV' },
  ods: { Icon: FileSpreadsheet, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Tableur' },

  ppt: { Icon: Presentation, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'PowerPoint' },
  pptx: { Icon: Presentation, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'PowerPoint' },
  odp: { Icon: Presentation, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Présentation' },

  zip: { Icon: FileArchive, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Archive' },
  rar: { Icon: FileArchive, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Archive' },
  '7z': { Icon: FileArchive, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Archive' },
  tar: { Icon: FileArchive, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Archive' },
  gz: { Icon: FileArchive, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Archive' },
};

const CODE_EXTS = new Set([
  'js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'toml', 'xml', 'sql',
]);

/** Resolve a file (by name + optional MIME) to its icon, tint and label. */
export function fileVisual(name: string, mime?: string): FileVisual {
  const e = ext(name);
  if (BY_EXT[e]) return BY_EXT[e]!;
  if (CODE_EXTS.has(e)) {
    return { Icon: FileCode, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Code' };
  }

  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return { Icon: FileImage, color: 'text-violet-300', bg: 'bg-violet-500/10', label: 'Image' };
  if (m.startsWith('video/')) return { Icon: FileVideo, color: 'text-rose-400', bg: 'bg-rose-500/10', label: 'Vidéo' };
  if (m.startsWith('audio/')) return { Icon: FileAudio, color: 'text-amber-300', bg: 'bg-amber-400/10', label: 'Audio' };
  if (m === 'application/pdf') return BY_EXT.pdf!;
  if (m.startsWith('text/') || m === 'application/json') {
    return { Icon: FileText, color: 'text-zinc-300', bg: 'bg-white/[0.06]', label: 'Texte' };
  }

  return { Icon: File, color: 'text-zinc-400', bg: 'bg-white/[0.06]', label: 'Fichier' };
}

/** Coarse preview category used by the in-app viewer. */
export type PreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'none';

export function previewKind(name: string, mime?: string): PreviewKind {
  const m = (mime ?? '').toLowerCase();
  const e = ext(name);
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(e)) return 'image';
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(e)) return 'audio';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(e)) return 'video';
  if (m.startsWith('text/') || m === 'application/json' || CODE_EXTS.has(e) || ['txt', 'md', 'log'].includes(e)) return 'text';
  return 'none';
}
