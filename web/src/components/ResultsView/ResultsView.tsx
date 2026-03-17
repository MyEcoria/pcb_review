import { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewResult, AnalysisResult, ReviewCheck, ReviewScoreSummary } from '../../types';
import styles from './ResultsView.module.css';

interface ResultsViewProps {
  results: ReviewResult[];
  analysisResult: AnalysisResult | null;
  executiveSummary: string;
  onBack: () => void;
  onExportMarkdown: () => void;
  onExportPDF: () => void;
  scoreSummary: ReviewScoreSummary;
}

export function ResultsView({
  results,
  analysisResult,
  executiveSummary,
  onBack,
  onExportMarkdown,
  onExportPDF,
  scoreSummary,
}: ResultsViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewCheck['status']>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | ReviewCheck['severity']>('all');
  const [groupBy, setGroupBy] = useState<'category' | 'severity'>('category');

  const successfulResults = useMemo(
    () => results.filter(r => !r.error && r.response),
    [results]
  );

  const failedResults = useMemo(
    () => results.filter(r => r.error),
    [results]
  );


  const allChecks = useMemo<ReviewCheck[]>(
    () => successfulResults.flatMap(result => result.checks ?? []),
    [successfulResults]
  );

  const normalizedIssues = useMemo(
    () => successfulResults.flatMap(result =>
      (result.checks ?? []).map(check => ({
        ...check,
        promptId: result.promptId,
        promptName: result.promptName,
      }))
    ),
    [successfulResults]
  );

  const categories = useMemo(
    () => Array.from(new Set(normalizedIssues.map(issue => issue.category?.trim()).filter(Boolean))) as string[],
    [normalizedIssues]
  );

  const filteredIssues = useMemo(
    () => normalizedIssues.filter(issue => {
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && (issue.category ?? 'uncategorized') !== categoryFilter) return false;
      return true;
    }),
    [normalizedIssues, statusFilter, severityFilter, categoryFilter]
  );

  const groupedIssues = useMemo(() => {
    const groups = new Map<string, typeof filteredIssues>();
    filteredIssues.forEach(issue => {
      const groupKey = groupBy === 'category' ? issue.category ?? 'uncategorized' : issue.severity;
      const group = groups.get(groupKey) ?? [];
      group.push(issue);
      groups.set(groupKey, group);
    });

    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, issues]) => ({ key, issues }));
  }, [filteredIssues, groupBy]);

  const suggestionsBySeverity = useMemo(() => {
    const severities: Array<ReviewCheck['severity']> = ['critical', 'high', 'medium', 'low', 'info'];
    return severities
      .map(severity => ({
        severity,
        checks: allChecks.filter(check => check.severity === severity && check.suggestion.trim()),
      }))
      .filter(group => group.checks.length > 0);
  }, [allChecks]);

  const fixSuggestionBullets = useMemo(
    () => filteredIssues
      .filter(issue => issue.suggestion.trim())
      .map(issue => `- [${issue.severity.toUpperCase()}][${issue.status.toUpperCase()}] ${issue.title} (${issue.category ?? 'uncategorized'}) — ${issue.suggestion}`),
    [filteredIssues]
  );

  const exportFixSuggestions = () => {
    const content = fixSuggestionBullets.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fix-suggestions.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyFixSuggestions = async () => {
    if (!fixSuggestionBullets.length || !navigator.clipboard) return;
    await navigator.clipboard.writeText(fixSuggestionBullets.join('\n'));
  };


  // Generate short summary for each section
  const getSectionSummary = useCallback((response: string): string => {
    // Try to extract the first meaningful paragraph or list
    const lines = response.split('\n').filter(l => l.trim());

    // Look for executive summary or first paragraph after a heading
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip headings
      if (line.startsWith('#')) continue;
      // Skip empty lines and short lines
      if (line.length < 20) continue;
      // Skip table rows
      if (line.startsWith('|')) continue;
      // Return first meaningful line, truncated
      if (line.length > 150) {
        return line.slice(0, 150) + '...';
      }
      return line;
    }

    return 'Click to expand and view details.';
  }, []);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedSections(new Set());
      setAllExpanded(false);
    } else {
      setExpandedSections(new Set(successfulResults.map(r => r.promptId)));
      setAllExpanded(true);
    }
  };

  const scrollToSection = (id: string) => {
    // Expand the section first
    setExpandedSections(prev => new Set(prev).add(id));
    // Then scroll to it
    setTimeout(() => {
      const element = document.getElementById(`section-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>Analysis Results</h1>
        <div className={styles.headerActions}>
          <button className={styles.exportButton} onClick={onExportMarkdown}>
            📄 Markdown
          </button>
          <button className={styles.exportButton} onClick={onExportPDF}>
            📄 PDF
          </button>
        </div>
      </header>

      {/* Executive Summary */}
      <section className={styles.summary}>
        <h2 className={styles.summaryTitle}>Executive Summary</h2>
        <div className={styles.summaryText}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {executiveSummary || 'No executive summary available.'}
          </ReactMarkdown>
        </div>
        {analysisResult && (
          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{analysisResult.summary.copperLayers}</span>
              <span className={styles.statLabel}>Layers</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{analysisResult.summary.totalComponents}</span>
              <span className={styles.statLabel}>Components</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{analysisResult.summary.totalNets}</span>
              <span className={styles.statLabel}>Nets</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{analysisResult.summary.totalVias}</span>
              <span className={styles.statLabel}>Vias</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{successfulResults.length}</span>
              <span className={styles.statLabel}>Analyses</span>
            </div>
          </div>
        )}
      </section>


      <section className={styles.scoreCard}>
        <h2 className={styles.summaryTitle}>Structured Review Score</h2>
        <div className={styles.scoreValue}>{scoreSummary.score} / {scoreSummary.total}</div>
        <div className={styles.scoreCounters}>
          <span className={styles.passCounter}>Pass: {scoreSummary.passed}</span>
          <span className={styles.failCounter}>Fail: {scoreSummary.failed}</span>
          <span className={styles.warningCounter}>Warning: {scoreSummary.warnings}</span>
        </div>
      </section>

      <section className={styles.triagePanel}>
        <h2 className={styles.summaryTitle}>Issue Triage</h2>
        <div className={styles.filterRow}>
          <label className={styles.filterLabel}>
            Status
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | ReviewCheck['status'])}>
              <option value="all">All</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="warning">Warning</option>
            </select>
          </label>
          <label className={styles.filterLabel}>
            Category
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
              <option value="uncategorized">uncategorized</option>
            </select>
          </label>
          <label className={styles.filterLabel}>
            Severity
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as 'all' | ReviewCheck['severity'])}>
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>
          </label>
        </div>
        <div className={styles.groupToggleRow}>
          <button className={styles.expandAllButton} onClick={() => setGroupBy('category')}>By category</button>
          <button className={styles.expandAllButton} onClick={() => setGroupBy('severity')}>By severity</button>
        </div>

        {groupedIssues.map(group => (
          <div key={group.key} className={styles.issueGroup}>
            <h3 className={styles.suggestionGroupTitle}>{group.key} ({group.issues.length})</h3>
            <div className={styles.issueList}>
              {group.issues.map(issue => (
                <article key={`${issue.promptId}-${issue.id}`} className={styles.issueCard}>
                  <div className={styles.issueHeader}>
                    <strong>{issue.title}</strong>
                    <span className={styles.issueMeta}>{issue.status} • {issue.severity}</span>
                  </div>
                  <p className={styles.issueEvidence}>{issue.evidence}</p>
                  {issue.suggestion && <p className={styles.issueSuggestion}><strong>Suggested fix:</strong> {issue.suggestion}</p>}
                  <button className={styles.tocLink} onClick={() => scrollToSection(issue.promptId)}>
                    Jump to source analysis: {issue.promptName}
                  </button>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      {suggestionsBySeverity.length > 0 && (
        <section className={styles.suggestionsPanel}>
          <h2 className={styles.summaryTitle}>Fix Suggestions</h2>
          <p className={styles.description}>Copy or export this remediation list for ticketing and implementation tracking.</p>
          <div className={styles.groupToggleRow}>
            <button className={styles.expandAllButton} onClick={copyFixSuggestions}>Copy bullets</button>
            <button className={styles.expandAllButton} onClick={exportFixSuggestions}>Export bullets</button>
          </div>
          {fixSuggestionBullets.length > 0 && (
            <pre className={styles.fixSuggestionsText}>{fixSuggestionBullets.join('\n')}</pre>
          )}
          {suggestionsBySeverity.map(group => (
            <div key={group.severity} className={styles.suggestionGroup}>
              <h3 className={styles.suggestionGroupTitle}>{group.severity.toUpperCase()}</h3>
              <ul className={styles.suggestionList}>
                {group.checks.map(check => (
                  <li key={`${group.severity}-${check.id}`} className={styles.suggestionItem}>
                    <strong>{check.title}</strong>
                    {check.category && <span className={styles.suggestionCategory}> ({check.category})</span>}: {check.suggestion}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Table of Contents */}
      <nav className={styles.toc}>
        <div className={styles.tocHeader}>
          <h3 className={styles.tocTitle}>Contents</h3>
          <button className={styles.expandAllButton} onClick={toggleAll}>
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
        <ul className={styles.tocList}>
          {successfulResults.map(result => (
            <li key={result.promptId} className={styles.tocItem}>
              <button
                className={styles.tocLink}
                onClick={() => scrollToSection(result.promptId)}
              >
                {result.promptName} ({result.checksExecuted ?? result.checks?.length ?? 0} checks executed)
              </button>
            </li>
          ))}
          {failedResults.length > 0 && (
            <li className={styles.tocItem}>
              <button
                className={`${styles.tocLink} ${styles.tocLinkError}`}
                onClick={() => scrollToSection('errors')}
              >
                Errors ({failedResults.length})
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* Analysis Sections */}
      <div className={styles.sections} data-report-content>
        {successfulResults.map(result => {
          const isExpanded = expandedSections.has(result.promptId);
          return (
            <section
              key={result.promptId}
              id={`section-${result.promptId}`}
              className={styles.section}
            >
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection(result.promptId)}
                aria-expanded={isExpanded}
              >
                <span className={styles.sectionIcon}>
                  {isExpanded ? '▼' : '▶'}
                </span>
                <div className={styles.sectionHeaderContent}>
                  <h3 className={styles.sectionTitle}>{result.promptName} ({result.checksExecuted ?? result.checks?.length ?? 0} checks executed)</h3>
                  {!isExpanded && (
                    <p className={styles.sectionSummary}>
                      {getSectionSummary(result.response)}
                    </p>
                  )}
                </div>
              </button>
              {isExpanded && (
                <div className={styles.sectionContent}>
                  {result.parseWarning && (
                    <div className={styles.parseWarning}>{result.parseWarning}</div>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.response}
                  </ReactMarkdown>
                </div>
              )}
            </section>
          );
        })}

        {/* Errors Section */}
        {failedResults.length > 0 && (
          <section id="section-errors" className={styles.section}>
            <button
              className={styles.sectionHeader}
              onClick={() => toggleSection('errors')}
              aria-expanded={expandedSections.has('errors')}
            >
              <span className={styles.sectionIcon}>
                {expandedSections.has('errors') ? '▼' : '▶'}
              </span>
              <div className={styles.sectionHeaderContent}>
                <h3 className={`${styles.sectionTitle} ${styles.errorTitle}`}>
                  Errors ({failedResults.length})
                </h3>
              </div>
            </button>
            {expandedSections.has('errors') && (
              <div className={styles.sectionContent}>
                {failedResults.map(result => (
                  <div key={result.promptId} className={styles.errorItem}>
                    <strong>{result.promptName} ({result.checksExecuted ?? result.checks?.length ?? 0} checks executed):</strong> {result.error}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
