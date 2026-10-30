import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Row = { id: string; text: string; recordId?: string | null; missionId?: string | null };
type Scope = { recordId?: string; missionId?: string };

// Scope before sending anything to the local model. Never accept IDs it was not given.
export function eligibleSemanticRows<T extends Row>(rows: T[], scope: Scope): T[] {
  return rows.filter(
    (r) =>
      (!scope.recordId || r.recordId === scope.recordId) &&
      (scope.missionId ? !r.missionId || r.missionId === scope.missionId : !r.missionId),
  );
}

export function semanticCandidates<T extends Row>(rows: T[], output: unknown) {
  if (!Array.isArray(output)) throw new Error('Invalid local embedding response');
  const allowed = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  return output
    .flatMap((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.score !== 'number' ||
        !Number.isFinite(item.score) ||
        item.score < 0.86 ||
        item.score > 1 ||
        seen.has(item.id)
      )
        return [];
      const row = allowed.get(item.id);
      if (!row) return [];
      seen.add(item.id);
      return [
        { ...row, score: item.score, matched: [] as string[], matchType: 'semantic' as const },
      ];
    })
    .slice(0, 8);
}

export async function localSemanticSearch<T extends Row>(rows: T[], query: string, scope: Scope) {
  const eligible = eligibleSemanticRows(rows, scope);
  // Fail closed rather than silently ranking an arbitrary subset.
  if (eligible.length > 200) throw new Error('Too many records for local semantic search');
  if (!eligible.length) return [];
  const script = fileURLToPath(new URL('../../../scripts/semantic-evidence.py', import.meta.url));
  const child = spawn(process.env.SEMANTIC_PYTHON || 'python3', [script], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const output = await new Promise<string>((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local semantic search timed out'));
    }, 30000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 16000) {
        child.kill('SIGKILL');
        reject(new Error('Invalid local embedding response'));
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(body);
      else reject(new Error('Local semantic search unavailable'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(
      JSON.stringify({
        query,
        rows: eligible.map(({ id, text }) => ({ id, text: text.slice(0, 4000) })),
      }),
    );
  });
  return semanticCandidates(eligible, JSON.parse(output));
}
