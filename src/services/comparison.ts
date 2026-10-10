import { DiffSegment, DocumentComparisonResult } from '../types';
import { extractTextFromRawPdfStream, isRawPdfStream } from '../utils/fileParser';

export function normalizeText(text: string): string {
  if (!text) return '';
  if (isRawPdfStream(text)) {
    const extracted = extractTextFromRawPdfStream(text);
    if (extracted) return extracted.trim();
  }
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function extractSections(text: string): { title: string; content: string }[] {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const sections: { title: string; content: string }[] = [];
  let currentTitle = 'Introduction / General';
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match Markdown headings or numbered sections like "1. Purpose", "Section 2:", "## Eligibility"
    if (
      trimmed.startsWith('#') ||
      /^(Section\s+\d+|[0-9]+\.\s+|[A-Z\s]{4,}:)/i.test(trimmed)
    ) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
        currentLines = [];
      }
      currentTitle = trimmed.replace(/^#+\s*/, '');
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

export function compareDocumentTexts(
  docMasterId: string,
  oldVersionId: string,
  oldVersionNumber: string,
  oldText: string,
  newVersionId: string,
  newVersionNumber: string,
  newText: string,
  explicitSummary?: string
): DocumentComparisonResult {
  const normOld = normalizeText(oldText || '');
  const normNew = normalizeText(newText || '');

  const oldLines = normOld ? normOld.split('\n') : [];
  const newLines = normNew ? normNew.split('\n') : [];

  const addedContent: string[] = [];
  const removedContent: string[] = [];
  const modifiedContent: { section: string; oldText: string; newText: string }[] = [];
  const diffSegments: DiffSegment[] = [];

  const oldSections = extractSections(normOld);
  const newSections = extractSections(normNew);

  const oldSectionMap = new Map<string, string>();
  oldSections.forEach((s) => oldSectionMap.set(s.title.toLowerCase(), s.content));

  const newSectionMap = new Map<string, string>();
  newSections.forEach((s) => newSectionMap.set(s.title.toLowerCase(), s.content));

  // Identify added & modified sections
  for (const [newTitleLower, newContent] of newSectionMap.entries()) {
    const origTitle = newSections.find((s) => s.title.toLowerCase() === newTitleLower)?.title || newTitleLower;
    if (!oldSectionMap.has(newTitleLower)) {
      addedContent.push(`[New Section: ${origTitle}]\n${newContent}`);
    } else {
      const oldContent = oldSectionMap.get(newTitleLower)!;
      if (oldContent.trim() !== newContent.trim()) {
        modifiedContent.push({
          section: origTitle,
          oldText: oldContent,
          newText: newContent,
        });
      }
    }
  }

  // Identify removed sections
  for (const [oldTitleLower, oldContent] of oldSectionMap.entries()) {
    const origTitle = oldSections.find((s) => s.title.toLowerCase() === oldTitleLower)?.title || oldTitleLower;
    if (!newSectionMap.has(oldTitleLower)) {
      removedContent.push(`[Removed Section: ${origTitle}]\n${oldContent}`);
    }
  }

  // Line-by-line diff building (Myers / simple LCS approximation for crisp display)
  const maxLines = Math.max(oldLines.length, newLines.length);
  const sideBySideLines: DocumentComparisonResult['sideBySideLines'] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oLine = oldLines[oldIdx];
    const nLine = newLines[newIdx];

    if (oLine === nLine && oLine !== undefined) {
      sideBySideLines.push({
        left: { lineNumber: oldIdx + 1, content: oLine, type: 'unchanged' },
        right: { lineNumber: newIdx + 1, content: nLine, type: 'unchanged' },
      });
      diffSegments.push({
        type: 'unchanged',
        value: oLine,
        oldLineNumber: oldIdx + 1,
        newLineNumber: newIdx + 1,
      });
      oldIdx++;
      newIdx++;
    } else if (oLine !== undefined && (nLine === undefined || !newLines.slice(newIdx, newIdx + 5).includes(oLine))) {
      // Line removed or modified
      if (nLine !== undefined && !oldLines.slice(oldIdx, oldIdx + 5).includes(nLine)) {
        // Direct modification on this line
        sideBySideLines.push({
          left: { lineNumber: oldIdx + 1, content: oLine, type: 'modified' },
          right: { lineNumber: newIdx + 1, content: nLine, type: 'modified' },
        });
        diffSegments.push({
          type: 'modified',
          value: nLine,
          oldValue: oLine,
          newValue: nLine,
          oldLineNumber: oldIdx + 1,
          newLineNumber: newIdx + 1,
        });
        oldIdx++;
        newIdx++;
      } else {
        // Removal
        sideBySideLines.push({
          left: { lineNumber: oldIdx + 1, content: oLine, type: 'removed' },
          right: { lineNumber: 0, content: '', type: 'empty' },
        });
        diffSegments.push({
          type: 'removed',
          value: oLine,
          oldLineNumber: oldIdx + 1,
        });
        oldIdx++;
      }
    } else if (nLine !== undefined) {
      // Addition
      sideBySideLines.push({
        left: { lineNumber: 0, content: '', type: 'empty' },
        right: { lineNumber: newIdx + 1, content: nLine, type: 'added' },
      });
      diffSegments.push({
        type: 'added',
        value: nLine,
        newLineNumber: newIdx + 1,
      });
      newIdx++;
    } else {
      break;
    }
  }

  // Calculate statistics
  const additionsCount = diffSegments.filter((d) => d.type === 'added').length + addedContent.length;
  const removalsCount = diffSegments.filter((d) => d.type === 'removed').length + removedContent.length;
  const modificationsCount = diffSegments.filter((d) => d.type === 'modified').length + modifiedContent.length;
  const totalRelevant = Math.max(1, oldLines.length + newLines.length);
  const unchangedCount = diffSegments.filter((d) => d.type === 'unchanged').length;
  const similarityPercentage = Math.min(100, Math.max(0, Math.round((unchangedCount * 2 * 100) / totalRelevant)));

  const computedSummary =
    explicitSummary ||
    (modificationsCount > 0 || additionsCount > 0 || removalsCount > 0
      ? `Comparison detected ${additionsCount} addition(s), ${removalsCount} removal(s), and ${modificationsCount} modification(s) between version ${oldVersionNumber} and ${newVersionNumber}.`
      : `No text alterations detected between version ${oldVersionNumber} and ${newVersionNumber}.`);

  return {
    id: `comp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    documentMasterId: docMasterId,
    oldVersionId,
    oldVersionNumber,
    newVersionId,
    newVersionNumber,
    comparisonDate: new Date().toISOString(),
    addedContent,
    removedContent,
    modifiedContent,
    changeSummary: computedSummary,
    comparisonAvailable: true,
    statistics: {
      additions: additionsCount,
      removals: removalsCount,
      modifications: modificationsCount,
      similarityPercentage,
    },
    diffSegments,
    sideBySideLines,
    reviewerValidated: false,
  };
}

function stripHtmlAndHeaders(raw: string): string {
  if (!raw) return '';
  let clean = raw
    .replace(/<!--AMAAVIGO_HEADER_START-->[\s\S]*?<!--AMAAVIGO_HEADER_END-->/gi, '')
    .replace(/<!--AMAAVIGO_FOOTER_START-->[\s\S]*?<!--AMAAVIGO_FOOTER_END-->/gi, '')
    .replace(/<table[^>]*class="[^"]*amaavigo-document-header[^"]*"[\s\S]*?<\/table>/gi, '')
    .replace(/<table[^>]*class="[^"]*amaavigo-document-footer[^"]*"[\s\S]*?<\/table>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    // Convert paragraph and block closing tags into clean paragraph breaks
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|article|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  return clean.trim();
}

export function diffWords(oldStr: string, newStr: string) {
  const oldTokens = oldStr.trim().split(/(\s+)/);
  const newTokens = newStr.trim().split(/(\s+)/);

  const cleanOld = oldTokens.filter((t) => t.trim().length > 0).map((t) => t.toLowerCase().replace(/[^a-z0-9]/gi, ''));
  const cleanNew = newTokens.filter((t) => t.trim().length > 0).map((t) => t.toLowerCase().replace(/[^a-z0-9]/gi, ''));

  const setNew = new Set(cleanNew);
  const setOld = new Set(cleanOld);

  const oldWords = oldTokens.map((token) => {
    const c = token.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const isRemoved = Boolean(c && !setNew.has(c));
    return { text: token, isRemoved };
  });

  const newWords = newTokens.map((token) => {
    const c = token.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const isAdded = Boolean(c && !setOld.has(c));
    return { text: token, isAdded };
  });

  return { oldWords, newWords };
}

export interface PointDiffItem {
  id: string;
  pointNumber: string;
  title: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldText: string;
  newText: string;
  oldWords: { text: string; isRemoved?: boolean }[];
  newWords: { text: string; isAdded?: boolean }[];
  summaryText?: string;
}

function generatePointSummary(type: 'added' | 'removed' | 'modified' | 'unchanged', oldWords: { text: string; isRemoved?: boolean }[], newWords: { text: string; isAdded?: boolean }[], title: string): string {
  if (type === 'unchanged') return 'Point remains unchanged from baseline version.';
  if (type === 'added') return `New point "${title}" introduced in this revision.`;
  if (type === 'removed') return `Point "${title}" was removed from previous baseline version.`;

  const addedSnippets = newWords
    .filter((w) => w.isAdded)
    .map((w) => w.text)
    .join(' ')
    .trim();

  const removedSnippets = oldWords
    .filter((w) => w.isRemoved)
    .map((w) => w.text)
    .join(' ')
    .trim();

  const truncate = (s: string, max = 130) => (s.length > max ? s.substring(0, max) + '...' : s);

  if (addedSnippets && removedSnippets) {
    return `Previously this was: "${truncate(removedSnippets)}", now changed to: "${truncate(addedSnippets)}".`;
  }
  if (addedSnippets) {
    return `Previously absent; now changed to include: "${truncate(addedSnippets)}".`;
  }
  if (removedSnippets) {
    return `Previously this was: "${truncate(removedSnippets)}", now removed in this version.`;
  }
  return `Point "${title}" modified from previous baseline version.`;
}

export function extractPointByPointDiffs(oldRaw: string, newRaw: string): PointDiffItem[] {
  const cleanOld = stripHtmlAndHeaders(oldRaw);
  const cleanNew = stripHtmlAndHeaders(newRaw);

  const splitPoints = (text: string) => {
    // 1. Initial split by double newlines / paragraph breaks
    const rawParagraphs = text
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.replace(/[\s\u00A0\u200B]+/g, '').length > 0);

    // 2. Further split blocks that contain numbered point markers e.g. "1. Purpose ... 2. Eligibility ..."
    const subSplitBlocks: string[] = [];
    rawParagraphs.forEach((block) => {
      const pointMatches = block.split(/(?=\b(?:\d+\.|Point\s+\d+|Section\s+\d+|Clause\s+\d+|Article\s+\d+)\s+[A-Za-z0-9])/g);
      pointMatches.forEach((sub) => {
        const trimmed = sub.trim();
        if (trimmed.length > 0) subSplitBlocks.push(trimmed);
      });
    });

    const items: { label: string; title: string; content: string }[] = [];

    subSplitBlocks.forEach((p, idx) => {
      // Strip metadata headers like "Policy Owner: Human Resources..."
      const cleanContent = p
        .replace(/Policy\s*Owner\s*:\s*Human\s*Resources/gi, '')
        .replace(/Effective\s*Date\s*:\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/gi, '')
        .replace(/Review\s*Frequency\s*:[^\n]*/gi, '')
        .replace(/Applies\s*To\s*:[^\n]*/gi, '')
        .trim();

      const textToUse = cleanContent || p;
      const firstLine = textToUse.split('\n')[0].trim();
      const matchHeader = firstLine.match(/^(?:Point\s+\d+|Section\s+\d+|Clause\s+\d+|Article\s+\d+|\d+\.|\d+\)|\#+)\s*(.*)/i);

      let label = `Point ${idx + 1}`;
      let title = firstLine.substring(0, 60).replace(/^#+\s*/, '').trim();

      if (matchHeader) {
        const matchedMarker = matchHeader[0].trim();
        label = matchedMarker.length > 25 ? matchedMarker.substring(0, 25) : matchedMarker;
        if (matchHeader[1]) {
          title = matchHeader[1].substring(0, 60).trim();
        }
      }

      if (!title || title.length < 3) {
        title = textToUse.substring(0, 50).trim();
      }

      items.push({
        label,
        title: title || `Point ${idx + 1}`,
        content: textToUse,
      });
    });

    return items;
  };

  const oldPoints = splitPoints(cleanOld);
  const newPoints = splitPoints(cleanNew);

  const results: PointDiffItem[] = [];

  const oldMatched = new Set<number>();
  const newMatched = new Set<number>();

  // 1. Match by title/label
  newPoints.forEach((nP, nIdx) => {
    const oIdx = oldPoints.findIndex((oP, i) => !oldMatched.has(i) && oP.title.toLowerCase() === nP.title.toLowerCase());
    if (oIdx !== -1) {
      oldMatched.add(oIdx);
      newMatched.add(nIdx);
      const oP = oldPoints[oIdx];
      const isSame = oP.content.trim() === nP.content.trim();
      const { oldWords, newWords } = diffWords(oP.content, nP.content);
      const type = isSame ? 'unchanged' : 'modified';

      results.push({
        id: `pt-${nIdx}-${oIdx}`,
        pointNumber: nP.label || `Point ${nIdx + 1}`,
        title: nP.title,
        type,
        oldText: oP.content,
        newText: nP.content,
        oldWords,
        newWords,
        summaryText: generatePointSummary(type, oldWords, newWords, nP.title),
      });
    }
  });

  // 2. Match remaining by index order
  newPoints.forEach((nP, nIdx) => {
    if (newMatched.has(nIdx)) return;
    const availableOldIdx = oldPoints.findIndex((_, i) => !oldMatched.has(i));

    if (availableOldIdx !== -1) {
      oldMatched.add(availableOldIdx);
      newMatched.add(nIdx);
      const oP = oldPoints[availableOldIdx];
      const isSame = oP.content.trim() === nP.content.trim();
      const { oldWords, newWords } = diffWords(oP.content, nP.content);
      const type = isSame ? 'unchanged' : 'modified';

      results.push({
        id: `pt-seq-${nIdx}-${availableOldIdx}`,
        pointNumber: nP.label || `Point ${nIdx + 1}`,
        title: nP.title || oP.title,
        type,
        oldText: oP.content,
        newText: nP.content,
        oldWords,
        newWords,
        summaryText: generatePointSummary(type, oldWords, newWords, nP.title || oP.title),
      });
    } else {
      // Added point
      newMatched.add(nIdx);
      const { newWords } = diffWords('', nP.content);
      results.push({
        id: `pt-add-${nIdx}`,
        pointNumber: nP.label || `Point ${nIdx + 1}`,
        title: nP.title,
        type: 'added',
        oldText: '(Point did not exist in baseline version)',
        newText: nP.content,
        oldWords: [],
        newWords,
        summaryText: generatePointSummary('added', [], newWords, nP.title),
      });
    }
  });

  // 3. Any leftover old points are removed
  oldPoints.forEach((oP, oIdx) => {
    if (!oldMatched.has(oIdx)) {
      const { oldWords } = diffWords(oP.content, '');
      results.push({
        id: `pt-rem-${oIdx}`,
        pointNumber: oP.label || `Point ${oIdx + 1}`,
        title: oP.title,
        type: 'removed',
        oldText: oP.content,
        newText: '(Point removed in new revision)',
        oldWords,
        newWords: [],
        summaryText: generatePointSummary('removed', oldWords, [], oP.title),
      });
    }
  });

  return results;
}
