import { useEffect, useState } from 'react';
import type { Request } from './profile-conversation.js';
export function CloudBackups({ id, api }: { id: string; api: Request }) {
  const [cloud, setCloud] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setCloud(null);
    setMessage('');
    api('/cloud-backups')
      .then((value) => {
        if (active) setCloud(value);
      })
      .catch(() => {
        if (active) setMessage('Cloud backup is unavailable. Local downloads are available.');
      });
    return () => {
      active = false;
    };
  }, [id]);
  const backup = async () => {
    setBusy(true);
    setMessage('');
    try {
      await api(`/resumes/${id}/cloud-backup`, 'POST', {});
      setCloud(await api('/cloud-backups'));
      setMessage('Approved resume backed up to private cloud storage.');
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-actions" aria-label="Cloud resume backups">
      {cloud?.enabled && (
        <button className="secondary" disabled={busy} onClick={backup}>
          {busy ? 'Backing up…' : 'Back up approved PDF to cloud'}
        </button>
      )}
      {cloud && !cloud.enabled && <small className="muted">Cloud backup is not configured.</small>}
      {message && <small role="status">{message}</small>}
      {!!cloud?.backups?.length && (
        <details>
          <summary>Cloud backups ({cloud.backups.length})</summary>
          <p className="small muted">
            Private approved PDFs. Download links expire after 60 seconds.
          </p>
          {cloud.backups.map((entry: any) => (
            <div key={entry.id}>
              <a className="secondary" href={`/api/cloud-backups/${entry.id}/download`}>
                Download backup · {new Date(entry.createdAt).toLocaleString('en-AU')}
              </a>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
