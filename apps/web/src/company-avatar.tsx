import React, { useState } from 'react';
import manifest from '../public/company-icons/sources.json' with { type: 'json' };
const aliases: Record<string, string> = {
  australianenergymarketoperator: 'aemo',
  vgwaustralia: 'vgw',
  hipagesgroup: 'hipages',
  imctrading: 'imc',
};
const key = (value: string) => {
  const k = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return aliases[k] || k;
};
function Icon({ name, label, small = false }: { name: string; label: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const asset = (manifest.icons as Record<string, { file: string }>)[key(name)];
  return (
    <span
      className={`company-avatar ${small ? 'company-avatar-small' : ''}`}
      role="img"
      aria-label={label}
    >
      {asset && !failed ? (
        <img src={`/company-icons/${asset.file}`} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{label.trim().slice(0, 1).toUpperCase() || '?'}</span>
      )}
    </span>
  );
}
export function CompanyAvatar({ job, small = false }: { job: any; small?: boolean }) {
  const board = key(job.source?.board || '');
  const company = key(job.company);
  const known = (manifest.icons as Record<string, unknown>)[board] ? board : company;
  return <Icon key={known} name={known} label={job.company || 'Employer'} small={small} />;
}
export function SourceIcon({ job }: { job: any }) {
  const name =
    job.source?.provider === 'manual' || !job.source?.provider
      ? job.source?.name
      : job.source.provider;
  return <Icon key={name} name={name || ''} label={job.source?.name || 'Job source'} small />;
}
