/**
 * History/markdown helper script extracted from the larger feedback UI script chunk.
 * This keeps markdown/history rendering logic separate from composer/theme/toast behavior.
 */

export const FEEDBACK_HTML_HISTORY_MARKDOWN_SCRIPT = String.raw`
  function formatHistoryTimestamp(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function safeMarkdownHref(rawUrl) {
    try {
      const url = new URL(String(rawUrl || '').trim(), window.location.href);
      const protocol = url.protocol.toLowerCase();
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        return url.toString();
      }
    } catch {
      // Ignore invalid URLs and fall back to plain text rendering.
    }
    return '';
  }

  function renderInlineMarkdown(value) {
    const tokens = [];

    function stash(html) {
      const token = '@@MDTOKEN' + tokens.length + '@@';
      tokens.push({ token, html });
      return token;
    }

    let text = String(value || '');
    text = text.replace(/\`([^\`\n]+)\`/g, (_, code) => stash('<code>' + escapeHtml(code) + '</code>'));
    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safeHref = safeMarkdownHref(href);
      if (!safeHref) {
        return stash(escapeHtml(label) + ' (' + escapeHtml(href) + ')');
      }
      return stash('<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noreferrer noopener">' + escapeHtml(label) + '</a>');
    });

    text = escapeHtml(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    tokens.forEach(({ token, html }) => {
      text = text.replace(token, html);
    });
    return text;
  }

  function renderMarkdownContent(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraphLines = [];
    let quoteLines = [];
    let listItems = [];
    let listType = '';
    let codeLines = [];
    let inCodeFence = false;

    function flushParagraph() {
      if (!paragraphLines.length) return;
      blocks.push('<p>' + paragraphLines.map(renderInlineMarkdown).join('<br>') + '</p>');
      paragraphLines = [];
    }

    function flushQuote() {
      if (!quoteLines.length) return;
      blocks.push('<blockquote>' + quoteLines.map(renderInlineMarkdown).join('<br>') + '</blockquote>');
      quoteLines = [];
    }

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push('<' + tag + '>' + listItems.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</' + tag + '>');
      listItems = [];
      listType = '';
    }

    function flushCodeFence() {
      if (!codeLines.length) return;
      blocks.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
      codeLines = [];
    }

    function flushTextBlocks() {
      flushParagraph();
      flushQuote();
      flushList();
    }

    for (const rawLine of lines) {
      if (inCodeFence) {
        if (/^\`\`\`/.test(rawLine)) {
          flushCodeFence();
          inCodeFence = false;
        } else {
          codeLines.push(rawLine);
        }
        continue;
      }

      if (/^\`\`\`/.test(rawLine)) {
        flushTextBlocks();
        inCodeFence = true;
        continue;
      }

      if (/^\s*$/.test(rawLine)) {
        flushTextBlocks();
        continue;
      }

      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(rawLine);
      if (headingMatch) {
        flushTextBlocks();
        const level = headingMatch[1].length;
        blocks.push('<h' + level + '>' + renderInlineMarkdown(headingMatch[2].trim()) + '</h' + level + '>');
        continue;
      }

      const orderedMatch = /^\s*\d+\.\s+(.*)$/.exec(rawLine);
      const unorderedMatch = /^\s*[-*]\s+(.*)$/.exec(rawLine);
      if (orderedMatch || unorderedMatch) {
        flushParagraph();
        flushQuote();
        const nextType = orderedMatch ? 'ol' : 'ul';
        if (listType && listType !== nextType) {
          flushList();
        }
        listType = nextType;
        listItems.push((orderedMatch ? orderedMatch[1] : unorderedMatch[1]).trim());
        continue;
      }

      const quoteMatch = /^\s*>\s?(.*)$/.exec(rawLine);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        quoteLines.push(quoteMatch[1]);
        continue;
      }

      flushQuote();
      paragraphLines.push(rawLine);
    }

    if (inCodeFence) {
      flushCodeFence();
    }
    flushTextBlocks();
    return blocks.join('');
  }
`;
