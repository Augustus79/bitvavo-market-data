"""Recover exact entry snapshots from Git history, read-only GitHub HTTPS only."""
import argparse
import base64
import datetime
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request
from core import digest,iso,load_journal,ms,signals_from
from run import HERE,ROOT,write

BASE='https://api.github.com/repos/Augustus79/bitvavo-market-data'

def get(path):
    # Never follows a caller-provided host; only GitHub repository reads.
    request=urllib.request.Request(BASE+path,method='GET',headers={
        'Accept':'application/vnd.github+json','User-Agent':'bitvavo-historical-research',
        **({'Authorization':'Bearer '+os.environ['GH_TOKEN']} if os.environ.get('GH_TOKEN') else {})})
    with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,default=ROOT)
    args=parser.parse_args();rows,_=load_journal(args.root);sigs=signals_from(rows)
    wanted={ms(s['snapshotAt']):s['snapshotAt'] for s in sigs}
    out=HERE/'cache'/'entry-snapshots';out.mkdir(parents=True,exist_ok=True)
    log=[]
    for t,at in sorted(wanted.items()):
        p=out/f'{t}.json'
        if p.exists():continue
        try:
            query=urllib.parse.urlencode(dict(path='snapshot.json',until=iso(t+120_000),per_page=1))
            commits=get('/commits?'+query)
            if not commits:log.append(dict(at=at,status='COMMIT_NOT_FOUND'));continue
            commit=commits[0]['sha']
            content=get('/contents/snapshot.json?'+urllib.parse.urlencode(dict(ref=commit)))
            raw=base64.b64decode(content['content']);snapshot=json.loads(raw)
            if snapshot['collectedAt']!=at:
                log.append(dict(at=at,status='EXACT_TIMESTAMP_NOT_FOUND',found=snapshot['collectedAt']));continue
            write(p,dict(commit=commit,snapshotBlob=content['sha'],sha256=digest(raw),snapshot=snapshot))
            log.append(dict(at=at,status='RECOVERED',commit=commit))
            time.sleep(.10)
        except Exception as e:
            log.append(dict(at=at,status='ERROR',error=str(e)));break
    write(HERE/'cache'/'recovery-log.json',dict(wanted=len(wanted),recovered=len(list(out.glob('*.json'))),events=log))
    print('ENTRY_RECOVERY',json.dumps(dict(wanted=len(wanted),recovered=len(list(out.glob('*.json'))),events=log)))

if __name__=='__main__':main()
