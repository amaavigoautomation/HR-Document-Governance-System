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
