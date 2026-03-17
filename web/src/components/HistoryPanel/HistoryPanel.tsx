import type { ReviewRunHistory } from '../../types';
import styles from './HistoryPanel.module.css';

interface HistoryPanelProps {
  history: ReviewRunHistory[];
  onBack: () => void;
  onLoadRun: (run: ReviewRunHistory) => void;
  onDeleteRun: (runId: string) => void;
  onClearAll: () => void;
}

export function HistoryPanel({ history, onBack, onLoadRun, onDeleteRun, onClearAll }: HistoryPanelProps) {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>← Back</button>
        <h1 className={styles.title}>Run History</h1>
        <button className={styles.clearButton} onClick={onClearAll} disabled={history.length === 0}>Clear All</button>
      </header>

      <main className={styles.content}>
        {history.length === 0 ? (
          <p className={styles.empty}>No previous runs saved yet.</p>
        ) : (
          <ul className={styles.list}>
            {history.map(run => (
              <li key={run.runId} className={styles.card}>
                <div>
                  <h2 className={styles.runTitle}>{new Date(run.timestamp).toLocaleString()}</h2>
                  <p className={styles.meta}>{run.provider} / {run.model}</p>
                  <p className={styles.meta}>Analyses: {run.selectedAnalyses.join(', ')}</p>
                  <p className={styles.meta}>Score: {run.scoreSummary.score}/{run.scoreSummary.total} · Pass {run.scoreSummary.passed} · Fail {run.scoreSummary.failed} · Warn {run.scoreSummary.warnings}</p>
                </div>
                <div className={styles.actions}>
                  <button className={styles.loadButton} onClick={() => onLoadRun(run)}>Load</button>
                  <button className={styles.deleteButton} onClick={() => onDeleteRun(run.runId)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
