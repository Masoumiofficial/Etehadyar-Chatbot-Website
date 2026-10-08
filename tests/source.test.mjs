import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { repository, fixture } from './helpers.mjs';

test('JavaScript scripts and PHP 7.4/8.3 source parse', async () => {
  for (const folder of ['assets/js', 'admin', 'scripts', 'tests']) {
    for (const file of await fs.readdir(path.join(repository, folder))) {
      if (/\.(?:js|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(repository, folder, file)]);
    }
  }
  for (const phpVersion of ['7.4', '8.3']) {
    const app = await fixture({ phpVersion });
    try {
      const parsed = await app.php.run({ code: '<?php foreach (["admin/lib.php", "admin/api.php", "scripts/setup-admin.php"] as $file) { token_get_all(file_get_contents("/site/" . $file), TOKEN_PARSE); } echo "OK";' });
      assert.equal(parsed.exitCode, 0); assert.equal(parsed.text, 'OK');
    } finally { await app.cleanup(); }
  }
});

test('local page resources, cross-page anchors, IDs, and structured data are valid', () => {
  execFileSync('python', ['-c', `
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json,re
root=Path('.').resolve()
class Page(HTMLParser):
 def __init__(self):
  super().__init__(); self.ids=[]; self.links=[]; self.schema=False; self.content=''; self.h1=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  assert not any(k.startswith('on') for k in a), (tag,'inline event handler')
  if 'id' in a: self.ids.append(a['id'])
  if tag=='h1': self.h1+=1
  for attr in ['href','src']:
   if a.get(attr): self.links.append(a[attr])
  if tag=='script' and a.get('type')=='application/ld+json': self.schema=True;self.content=''
 def handle_data(self,text):
  if self.schema:self.content+=text
 def handle_endtag(self,tag):
  if tag=='script' and self.schema:json.loads(self.content);self.schema=False
pages={}
for relative in ['index.html','about/index.html','docs/index.html','changelog/index.html','admin/index.html']:
 file=root/relative;p=Page();p.feed(file.read_text());pages[file]=p
 assert len(p.ids)==len(set(p.ids)),(file,'duplicate IDs')
 assert p.h1==1,(file,'expected one main heading')
for file,p in pages.items():
 for link in p.links:
  u=urlsplit(link)
  if u.scheme or u.netloc:continue
  target=(root/u.path.lstrip('/') if u.path.startswith('/') else file.parent/unquote(u.path) if u.path else file).resolve()
  if target.is_dir():target=target/'index.html'
  assert target.is_file(),(file,link,'missing file')
  if u.fragment and target in pages:assert unquote(u.fragment) in pages[target].ids,(file,link,'missing anchor')
`,], { cwd: repository });
});

test('no browser password or simulated server-save fallback remains', async () => {
  const frontend = await fs.readFile(path.join(repository, 'admin/admin.js'), 'utf8');
  assert.ok(!frontend.includes('localStorage.setItem'));
  assert.ok(!frontend.includes('sessionStorage.setItem'));
  assert.ok(!frontend.includes('.innerHTML'));
  const api = await fs.readFile(path.join(repository, 'admin/api.php'), 'utf8');
  assert.ok(!api.includes('etehadyar2026'));
  const content = JSON.parse(await fs.readFile(path.join(repository, 'data/site_data.json'), 'utf8'));
  assert.equal(content.config.purchaseUrlIR, ''); assert.equal(content.config.purchaseUrlInternational, '');
  assert.equal(content.config.totalReleases, String(content.releases.filter(release => !release.is_alpha).length));
});

test('deployment archive is reproducible and contains no private files or node_modules', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'etehadyar-release-test-'));
  try {
    const first = path.join(directory, 'first.zip'); const second = path.join(directory, 'second.zip');
    execFileSync('python', ['scripts/build-release.py', '--output', first], { cwd: repository });
    execFileSync('python', ['scripts/build-release.py', '--output', second], { cwd: repository });
    assert.deepEqual(await fs.readFile(first), await fs.readFile(second));
    execFileSync('python', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; names=z.namelist(); assert 'data/site_data.json' in names; assert 'admin/lib.php' in names; assert '.htaccess' in names; assert 'admin/.htaccess' in names; assert 'deploy/nginx.conf.example' in names; assert not any('node_modules' in n or 'credentials' in n or 'admin_creds' in n or '.git/' in n or n.startswith('tests/') or 'dev-server' in n for n in names)`, first]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('vendored scroll runtime matches the pinned package and includes its MIT license', async () => {
  const packaged = await fs.readFile(path.join(repository, 'node_modules/lenis/dist/lenis.min.js'), 'utf8');
  const shipped = await fs.readFile(path.join(repository, 'assets/js/vendor/lenis-1.3.26.min.js'), 'utf8');
  assert.equal(shipped, packaged.split('//# sourceMappingURL=')[0].trimEnd() + '\n');
  assert.equal(await fs.readFile(path.join(repository, 'assets/js/vendor/lenis-LICENSE.txt'), 'utf8'), await fs.readFile(path.join(repository, 'node_modules/lenis/LICENSE'), 'utf8'));
  execFileSync(process.execPath, ['--check', path.join(repository, 'assets/js/vendor/lenis-1.3.26.min.js')]);
});
