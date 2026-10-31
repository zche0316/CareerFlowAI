import React, { useEffect, useState } from 'react';
import { ProfileCanvas } from './profile-canvas.js';
import type { Request } from './profile-conversation.js';

/** Review the immutable profile attached to this journey, not the current global draft. */
export function MissionProfile({
  missionId,
  api,
  onContinue,
  completed = false,
}: {
  completed?: boolean;
  missionId: string;
  api: Request;
  onContinue: () => void;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api(`/missions/${missionId}`)
      .then((m) => {
        if (active) setProfile(m.profile);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [missionId]);
  if (error) return <p role="alert">Could not load this journey’s profile: {error}</p>;
  if (!profile) return <p role="status">Loading this journey’s approved profile…</p>;
  return (
    <section aria-label="Journey profile snapshot">
      <h2>Approved profile v{profile.version}</h2>
      <p>
        This is the profile used for this application journey. To change your main profile, open My
        profile and start a new journey after approving it.
      </p>
      <button className="primary" onClick={onContinue}>
        {completed ? 'Back to journey results' : 'Continue this journey'}
      </button>
      <ProfileCanvas
        data={profile.data}
        proposals={[]}
        busy={false}
        error=""
        applied={{}}
        approved
        onDecision={() => {}}
        onApplyAll={() => {}}
      />
    </section>
  );
}
