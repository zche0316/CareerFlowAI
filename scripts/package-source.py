#!/usr/bin/env python3
"""Create a reviewable Canvas source snapshot, including relevant untracked code."""
import argparse, datetime, hashlib, json, subprocess, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DIRS = ['apps','packages','prisma','scripts','tests','docs','.github','.vscode']
FILES = ['package.json','package-lock.json','README.md','AGENTS.md','.env.example','.gitignore','.dockerignore','.prettierrc.json','Dockerfile','compose.yaml','tsconfig.json','prisma.config.ts','vitest.config.ts','playwright.config.ts','CareerFlowAI.code-workspace']
BLOCKED = {'node_modules','.git','.runtime','output','dist','test-results','playwright-report','__pycache__'}
def candidates():
    paths = [ROOT / f for f in FILES if (ROOT / f).is_file()]
    for folder in DIRS:
        base = ROOT / folder
        if base.exists(): paths.extend(p for p in base.rglob('*') if p.is_file())
    for p in sorted(set(paths)):
        rel = p.relative_to(ROOT)
        if any(part in BLOCKED for part in rel.parts): continue
        if p.name.startswith('.env') and p.name != '.env.example': continue
        if p.suffix.lower() in {'.pem','.key','.p12','.pfx','.log','.pyc'}: continue
        if p.is_symlink(): raise RuntimeError(f'Refusing symlink in source snapshot: {rel}')
        yield p, rel.as_posix()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output');args=parser.parse_args()
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target=Path(args.output).resolve() if args.output else ROOT/'output'/'releases'/f'CareerFlowAI_source_{stamp}.zip'
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists(): raise RuntimeError('Archive already exists; choose a new path.')
    entries=[]
    for p,name in candidates():
        data=p.read_bytes();entries.append((name,data))
    names={n for n,_ in entries}
    for name in ['package-lock.json','.env.example','prisma/schema.prisma','scripts/local-run.mjs','packages/matching/jobs.json']:
        if name not in names: raise RuntimeError(f'Missing required source file: {name}')
    try: revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    except (OSError,subprocess.CalledProcessError): revision=None
    manifest={'createdAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseCommit':revision,'snapshot':'Current source including relevant local modifications and untracked files; not a claim of a reviewed release.','files':[{'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in entries]}
    with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,data in entries: archive.writestr('CareerFlowAI/'+name,data)
        archive.writestr('CareerFlowAI/RELEASE_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    # Reopen the result and validate all listed bytes, not just ZIP creation success.
    with zipfile.ZipFile(target) as archive:
        for f in manifest['files']:
            if hashlib.sha256(archive.read('CareerFlowAI/'+f['path'])).hexdigest()!=f['sha256']: raise RuntimeError('Archive verification failed.')
    print(json.dumps({'archive':str(target),'sourceFiles':len(entries),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'warning':'Candidate snapshot only. Teammates must review; Canvas upload/download has not occurred.'},indent=2))
if __name__=='__main__': main()
