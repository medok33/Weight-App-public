'use client';

import type { ReactNode } from 'react';
import type { ContentNamespace } from '@/i18n/content/types';

const KEY_PATTERN = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

/** Replace known meal/workout content keys with localized labels. */
export function localizeContentKeys(
  text: string,
  tc: (namespace: ContentNamespace, key: string) => string,
): string {
  return text.replace(KEY_PATTERN, (match) => {
    for (const ns of ['meal', 'workout', 'product'] as ContentNamespace[]) {
      const label = tc(ns, match);
      if (label !== match) return label;
    }
    return match;
  });
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={`b-${key++}`}>{match[1] ?? match[2]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Lightweight markdown for assistant replies: paragraphs, bullets, bold.
 * Does not execute HTML.
 */
export function AssistantRichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="wa-assistant-md-list">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1] ?? '');
      continue;
    }
    flushList();
    if (!line.trim()) {
      blocks.push(<div key={`sp-${key++}`} className="wa-assistant-md-gap" />);
      continue;
    }
    blocks.push(
      <p key={`p-${key++}`} className="wa-assistant-md-p">
        {renderInline(line.trim())}
      </p>,
    );
  }
  flushList();

  return <div className="wa-assistant-md">{blocks}</div>;
}
