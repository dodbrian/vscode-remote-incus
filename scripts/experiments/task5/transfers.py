import os,pathlib,json,subprocess,time,shlex,uuid,re
root=pathlib.Path(os.environ['INCUS_EXPERIMENT_ROOT']);env={**os.environ,'INCUS_CONF':str(root/'off')}
target=os.environ['INCUS_TEST_TARGET']
if os.environ.get('CI') or os.environ.get('INCUS_TEST_ALLOW_DESTRUCTIVE') != 'yes' or not re.fullmatch(r'[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+',target):
 raise SystemExit('Explicit idle test target and destructive opt-in required; CI refused')
meta=json.loads((root/'metadata.json').read_text());archive=(root/'archive-path').read_text();nonce=uuid.uuid4().hex[:12]
results=[];paths=[]
def run(args,**kw):
 return subprocess.run(args,env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw).stdout.decode()
def execute(script,user=False,group=False):
 args=['incus','exec',target,'--mode','non-interactive']
 if user:args+=['--user',str(uid),'--env','HOME='+home]
 if group:args+=['--group',str(gid)]
 return run(args+['--','bash','-c',script],timeout=300)
passwd=execute('getent passwd').splitlines();users=[l.split(':') for l in passwd if len(l.split(':'))==7]
u=sorted([x for x in users if 1000<=int(x[2])<65534 and x[5].startswith('/home') and not x[6].endswith(('nologin','false'))],key=lambda x:int(x[2]))[0]
uid=int(u[2]);gid=int(u[3]);home=u[5]
assert not execute("pgrep -f '\\.vscode-serve[r]/relay\\.js|out/serv[e]r-main\\.js' || true").strip()
(root/'identity.json').write_text(json.dumps({'uid':uid,'gid':gid,'home':home}))
helper=os.environ['INCUS_TRANSFER_HELPER']
try:
 for mode in ['cli','sftp-sequential','sftp-concurrent','http','container-download']:
  dest='/tmp/incus-transfer-'+nonce+'-'+mode+'.partial';paths.append(dest);started=time.monotonic()
  if mode=='cli':
   run(['incus','file','push',archive,target+dest,'--uid',str(uid),'--gid',str(gid),'--mode','600'],timeout=300);extra={}
  elif mode=='container-download':
   execute('set -e\numask 077\ncurl --fail --silent --show-error --location --proto =https --proto-redir =https --connect-timeout 10 --max-time 180 --output '+shlex.quote(dest)+' '+shlex.quote(meta['url']),True,True);extra={}
  else:
   e={**env,'INCUS_TEST_TARGET':target,'INCUS_TRANSFER_MODE':mode,'INCUS_TRANSFER_LOCAL':archive,'INCUS_TRANSFER_REMOTE':dest,'INCUS_TRANSFER_UID':str(uid),'INCUS_TRANSFER_GID':str(gid),'INCUS_TRANSFER_MODE_BITS':'600'}
   p=subprocess.run([helper],env=e,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300);extra=json.loads(p.stdout)
  elapsed=round(1000*(time.monotonic()-started))
  evidence=execute('set -e\ntest ! -L '+shlex.quote(dest)+'\nsha256sum '+shlex.quote(dest)+'\nstat -c "%s %u %g %a" '+shlex.quote(dest),True).splitlines()
  assert evidence[0].split()[0]==meta['sha256hash'],'hash mismatch'
  assert evidence[1].split()==[str(os.path.getsize(archive)),str(uid),str(gid),'600'],'metadata mismatch'
  record={'mode':mode,'wall_ms':elapsed,'bytes':os.path.getsize(archive),'sha256_verified':True,'metadata_verified':True,'progress_polling':False,'details':extra}
  results.append(record);print(json.dumps(record),flush=True);(root/'transfer-results.json').write_text(json.dumps(results,indent=2))
  if mode=='container-download':
   seed='/tmp/vscode-server-linux-x64-'+meta['version']+'.tar.gz'
   execute('mv -- '+shlex.quote(dest)+' '+shlex.quote(seed),True)
   (root/'seed-ready').write_text('yes')
  else: execute('rm -f -- '+shlex.quote(dest),True)
finally:
 for p in paths:
  try:execute('rm -f -- '+shlex.quote(p),True)
  except Exception: print('CLEANUP FAILURE',flush=True)
