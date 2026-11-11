import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('reposhield_guard.py').resolve()
spec = importlib.util.spec_from_file_location('guard', SCRIPT)
g = importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.home=self.base/'home';self.home.mkdir()
        self.env=dict(os.environ,REPOSHIELD_NO_BROWSER='1',HOME=str(self.home),XDG_DATA_HOME=str(self.home/'data'),GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=str(self.home/'.gitconfig'),
            GIT_AUTHOR_NAME='Test',GIT_AUTHOR_EMAIL='test@example.invalid',
            GIT_COMMITTER_NAME='Test',GIT_COMMITTER_EMAIL='test@example.invalid')
        self.repo=self.base/'repo';self.repo.mkdir()
        self.git('init','-b','main');self.write('README.md','safe\n');self.commit('initial')
    def tearDown(self):self.tmp.cleanup()
    def git(self,*args,cwd=None,check=True):
        return subprocess.run(['/usr/bin/git',*args],cwd=cwd or self.repo,env=self.env,check=check,capture_output=True,text=True)
    def cli(self,*args,cwd=None,data=None):
        return subprocess.run(['/usr/bin/python3','-I','-S','-B',str(SCRIPT),*args],cwd=cwd or self.repo,env=self.env,input=data,capture_output=True,text=True)
    def write(self,path,text):
        p=self.repo/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
    def commit(self,msg):
        self.git('add','.');self.git('commit','-m',msg);return self.git('rev-parse','HEAD').stdout.strip()
    def payload(self):return 'init();'+'\t'*180+"var z='-1000';var NX,SX,spin,splitLane,peel;(function(){var a=['c^mejb^tro'];"+'x'*300+'})(global,require);\n'
    def test_hidden_extensionless_payload(self):
        f=g.inspect('init',self.payload().encode());self.assertEqual(f[0]['line'],1);self.assertIn('instruction',f[0])
        self.assertFalse(g.inspect('init',b'function init() {}\ninit();\n'))
    def test_fake_font_and_binary_false_positive(self):
        self.assertTrue(g.inspect('assets/font.ttf',b"global['!']='bad';require('http');"))
        self.assertFalse(g.inspect('assets/font.woff2',b'wOF2'+b'\0'*30+b'v8('))
    def test_limits_fail_closed(self):
        self.write('large', 'x'*(g.MAX_BLOB+1));self.commit('large')
        r=self.cli('scan');self.assertNotEqual(r.returncode,0);self.assertIn('incomplete',r.stderr)
    def test_push_scans_objects_not_working_files(self):
        old=self.git('rev-parse','HEAD').stdout.strip();self.write('init',self.payload());bad=self.commit('bad')
        self.write('init','safe\n')
        r=self.cli('pre-push',data=f'refs/heads/main {bad} refs/heads/main {old}\n')
        self.assertNotEqual(r.returncode,0);self.assertIn('"path": "init"',r.stderr)
    def test_intermediate_commit_cannot_hide_payload(self):
        old=self.git('rev-parse','HEAD').stdout.strip();self.write('init',self.payload());self.commit('bad')
        self.write('init','safe\n');new=self.commit('clean')
        r=self.cli('pre-push',data=f'refs/heads/main {new} refs/heads/main {old}\n')
        self.assertNotEqual(r.returncode,0)
    def test_cleanup_of_existing_remote_commit_allowed(self):
        self.write('init',self.payload());old=self.commit('already remote')
        self.write('init','safe\n');new=self.commit('remove payload')
        r=self.cli('pre-push',data=f'refs/heads/main {new} refs/heads/main {old}\n')
        self.assertEqual(r.returncode,0,r.stderr)
    def test_deletion_and_malformed_input(self):
        self.assertEqual(self.cli('pre-push',data='(delete) '+'0'*40+' refs/heads/bad '+'1'*40+'\n').returncode,0)
        self.assertNotEqual(self.cli('pre-push',data='broken\n').returncode,0)
    def setup_remote(self):
        remote=self.base/'remote.git';self.git('init','--bare',str(remote))
        self.git('remote','add','origin',str(remote));self.git('push','-u','origin','main')
        clone=self.base/'clone';self.git('clone','-b','main',str(remote),str(clone));return clone
    def enable_repair(self):
        r=self.cli('enable');self.assertEqual(r.returncode,0,r.stderr)
        r=self.cli('repair','on');self.assertEqual(r.returncode,0,r.stderr)
    def test_push_automatically_repairs_private_history(self):
        clone=self.setup_remote();self.enable_repair()
        self.write('init',self.payload());bad=self.commit('bad')
        self.write('feature.txt','keep this work');self.commit('feature')
        r=self.cli('git-proxy','push','--porcelain','--progress','origin','main:main')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('recognized payloads removed',r.stderr)
        self.assertEqual((self.repo/'init').read_text(),'init();\n')
        self.assertEqual((self.repo/'feature.txt').read_text(),'keep this work')
        self.assertEqual(self.git('status','--porcelain').stdout,'')
        self.assertNotEqual(self.git('for-each-ref','refs/reposhield/recovery/').stdout,'')
        self.git('fetch','origin','main',cwd=clone)
        r=self.cli('scan','FETCH_HEAD',cwd=clone);self.assertEqual(r.returncode,0,r.stderr)
        self.assertNotEqual(self.git('merge-base','--is-ancestor',bad,'HEAD',check=False).returncode,0)
    def test_push_unknown_payload_and_dirty_work_untouched(self):
        self.setup_remote();self.enable_repair()
        self.write('init',self.payload().replace('var NX,SX,spin,splitLane,peel;', 'var NX;'))
        head=self.commit('unknown')
        r=self.cli('git-proxy','push','origin','main');self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.git('rev-parse','HEAD').stdout.strip(),head)
        self.write('my-work.txt','precious')
        r=self.cli('git-proxy','push','origin','main');self.assertNotEqual(r.returncode,0)
        self.assertEqual((self.repo/'my-work.txt').read_text(),'precious')
    def test_push_shared_infection_not_rewritten(self):
        self.setup_remote();self.write('init',self.payload());head=self.commit('published bad')
        self.git('push','origin','main');self.enable_repair()
        r=self.cli('git-proxy','push','origin','main')
        self.assertNotEqual(r.returncode,0);self.assertEqual(self.git('rev-parse','HEAD').stdout.strip(),head)
    def test_verified_remote_repair_can_be_pulled(self):
        clone=self.setup_remote();self.write('init',self.payload());bad=self.commit('bad')
        self.write('init','init();\n');clean=self.commit('repair\n\nRepoShield-Repair: padding-tail-v1')
        self.git('push','origin','main')
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('locally verified repair',r.stdout)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),clean)
        self.assertEqual((clone/'init').read_text(),'init();\n')
    def test_infected_current_head_advances_only_to_verified_repair(self):
        clone=self.setup_remote();self.write('init',self.payload());self.commit('bad');self.git('push','origin','main')
        self.git('pull','--ff-only','origin','main',cwd=clone)
        self.write('init','init();\n');clean=self.commit('repair\n\nRepoShield-Repair: padding-tail-v1');self.git('push','origin','main')
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),clean)
        self.assertEqual((clone/'init').read_text(),'init();\n')
    def test_forged_repair_marker_does_not_approve_history(self):
        clone=self.setup_remote();old=self.git('rev-parse','HEAD').stdout.strip()
        self.write('init',self.payload());self.commit('bad')
        self.write('init','different legitimate code\n');self.commit('fake\n\nRepoShield-Repair: padding-tail-v1')
        self.git('push','origin','main')
        r=self.cli('pull','origin','main',cwd=clone);self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),old)
    def test_repaired_branch_does_not_whitelist_infected_tag(self):
        clone=self.setup_remote();old=self.git('rev-parse','HEAD').stdout.strip()
        self.write('init',self.payload());self.commit('bad');self.git('tag','infected')
        self.write('init','init();\n');self.commit('repair\n\nRepoShield-Repair: padding-tail-v1')
        self.git('push','origin','main','--tags')
        r=self.cli('git-proxy','pull','--tags','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),old)
    def test_repair_rule_preserves_crlf_and_refuses_ambiguous_prefix(self):
        raw=self.payload().replace('\n','\r\n').encode()
        self.assertEqual(g.repair_blob('init',raw),b'init();\r\n')
        with self.assertRaises(g.Blocked):g.repair_blob('init',raw.replace(b'init();',b'const data ='))
    def test_new_branch_scans_novel_commits_but_not_already_remote_history(self):
        remote=self.base/'remote.git';self.git('init','--bare',str(remote));self.git('remote','add','origin',str(remote))
        self.write('init',self.payload());self.commit('bad already remote')
        self.git('push','origin','main')
        self.write('init','init();\n');clean=self.commit('clean')
        self.git('switch','-c','new-branch')
        self.assertEqual(self.cli('install','--runtime',str(self.base/'runtime')).returncode,0)
        r=self.git('push','origin','new-branch',check=False)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('every newly uploaded commit passed',r.stderr)
        self.assertEqual(self.git('for-each-ref','refs/reposhield/push-baseline/').stdout,'')
    def test_new_branch_cannot_hide_novel_infected_intermediate_commit(self):
        self.setup_remote();self.git('switch','-c','new-branch')
        self.write('init',self.payload());self.commit('new bad')
        self.write('init','init();\n');self.commit('clean tip')
        self.assertEqual(self.cli('install','--runtime',str(self.base/'runtime')).returncode,0)
        r=self.git('push','origin','new-branch',check=False)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.git('ls-remote','origin','refs/heads/new-branch').stdout,'')
    def test_tags_pull_preserves_annotated_tags(self):
        clone=self.setup_remote()
        self.write('new.txt','safe');new=self.commit('new')
        self.git('tag','-a','v1','-m','release');tag=self.git('rev-parse','refs/tags/v1').stdout.strip()
        self.git('push','origin','main','--tags')
        r=self.cli('git-proxy','pull','--tags','origin','main',cwd=clone)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),new)
        self.assertEqual(self.git('rev-parse','refs/tags/v1',cwd=clone).stdout.strip(),tag)
        self.assertEqual(self.git('for-each-ref','refs/reposhield',cwd=clone).stdout,'')
    def test_malicious_tag_blocks_clean_branch(self):
        clone=self.setup_remote();old=self.git('rev-parse','HEAD').stdout.strip()
        self.write('init',self.payload());self.commit('bad');self.git('tag','bad-tag')
        self.git('reset','--hard',old);self.write('new.txt','safe');self.commit('clean')
        self.git('push','origin','main','--tags')
        r=self.cli('git-proxy','pull','--tags','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertIn('suspicious code',r.stderr)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),old)
        self.assertEqual(self.git('tag','--list',cwd=clone).stdout,'')
    def test_tag_conflict_does_not_update_branch(self):
        clone=self.setup_remote();old=self.git('rev-parse','HEAD').stdout.strip()
        self.git('tag','v1',cwd=clone)
        self.write('new.txt','safe');self.commit('new');self.git('tag','v1');self.git('push','origin','main','--tags')
        r=self.cli('git-proxy','pull','--tags','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertIn('Tag conflict',r.stderr)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),old)
    def test_option_error_is_not_malware_verdict(self):
        r=self.cli('git-proxy','pull','--rebase','origin','main')
        self.assertNotEqual(r.returncode,0);self.assertIn('--rebase',r.stderr)
        self.assertIn('does not establish whether malware',r.stderr)
    def test_infected_pull_never_updates_head_or_worktree(self):
        clone=self.setup_remote();old=self.git('rev-parse','HEAD',cwd=clone).stdout.strip()
        self.write('init',self.payload());self.commit('bad');self.git('push','origin','main')
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0,r.stderr);self.assertFalse((clone/'init').exists())
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),old)
        self.assertEqual(self.git('for-each-ref','refs/reposhield',cwd=clone).stdout,'')
    def test_clean_pull_and_dirty_refusal(self):
        clone=self.setup_remote();self.write('new.txt','safe');new=self.commit('new');self.git('push','origin','main')
        r=self.cli('pull','origin','main',cwd=clone);self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.git('rev-parse','HEAD',cwd=clone).stdout.strip(),new)
        (clone/'local.txt').write_text('keep');r=self.cli('pull','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertEqual((clone/'local.txt').read_text(),'keep')
    def test_no_checkout_hooks_or_custom_attributes_run(self):
        clone=self.setup_remote();sentinel=self.base/'executed'
        hook=clone/'.git/hooks/post-merge';hook.write_text('#!/bin/sh\ntouch '+str(sentinel)+'\n');hook.chmod(0o700)
        self.write('safe','clean');self.commit('safe');self.git('push','origin','main')
        self.assertEqual(self.cli('pull','origin','main',cwd=clone).returncode,0);self.assertFalse(sentinel.exists())
        self.write('.gitattributes','* filter=evil\n');self.commit('filter');self.git('push','origin','main')
        self.assertNotEqual(self.cli('pull','origin','main',cwd=clone).returncode,0)
    def test_installed_hook_blocks_actual_push_and_preserves_previous_hook(self):
        self.setup_remote();runtime=self.base/'trusted-runtime'
        hook=self.repo/'.git/hooks/pre-push';hook.write_text('#!/bin/sh\nexit 7\n');hook.chmod(0o700)
        r=self.cli('install','--runtime',str(runtime));self.assertEqual(r.returncode,0,r.stderr)
        self.write('safe','safe');self.commit('clean')
        self.assertNotEqual(self.git('push','origin','main',check=False).returncode,0)
        hook.write_text('#!/bin/sh\nexit 0\n')
        self.assertEqual(self.git('push','origin','main',check=False).returncode,0)
        self.write('init',self.payload());self.commit('bad')
        r=self.git('push','origin','main',check=False);self.assertNotEqual(r.returncode,0);self.assertIn('RepoShield BLOCKED',r.stderr)
    def test_shim_blocks_plain_pull_and_no_verify_push(self):
        clone=self.setup_remote();runtime=self.base/'runtime'
        self.assertEqual(self.cli('install','--runtime',str(runtime),cwd=clone).returncode,0)
        shim=runtime/'bin/git'
        self.write('init',self.payload());self.commit('bad');self.git('push','origin','main')
        r=subprocess.run([str(shim),'-C',str(clone),'pull','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0,r.stderr);self.assertFalse((clone/'init').exists())
        r=subprocess.run([str(shim),'-C',str(clone),'push','--no-verify'],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0);self.assertIn('bypass',r.stderr)
    def test_missing_remote_base_blocks_push(self):
        head=self.git('rev-parse','HEAD').stdout.strip()
        r=self.cli('pre-push',data=f'refs/heads/main {head} refs/heads/main '+ 'f'*40+'\n')
        self.assertNotEqual(r.returncode,0)
    def test_pull_refuses_existing_local_smudge_attributes(self):
        clone=self.setup_remote();(clone/'.git/info/attributes').write_text('* filter=evil\n')
        sentinel=self.base/'smudge-ran'
        self.git('config','filter.evil.clean','touch '+str(sentinel),cwd=clone)
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertFalse(sentinel.exists())
    def test_custom_transport_command_is_not_executed(self):
        clone=self.setup_remote();sentinel=self.base/'transport-ran'
        self.git('config','remote.origin.uploadpack','touch '+str(sentinel),cwd=clone)
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertFalse(sentinel.exists())
    def test_modified_local_attributes_block_before_status(self):
        clone=self.setup_remote();sentinel=self.base/'clean-ran'
        (clone/'.gitattributes').write_text('* filter=evil\n')
        self.git('config','filter.evil.clean','touch '+str(sentinel),cwd=clone)
        r=self.cli('pull','origin','main',cwd=clone)
        self.assertNotEqual(r.returncode,0);self.assertFalse(sentinel.exists())
    def test_reviewed_fixture_is_exact_hash_not_test_path_bypass(self):
        import hashlib
        path='src/lib/scanner/pipeline.test.ts'
        fixture=b'const example = `\nglobal["!"]=1;eval("void 0");\n`;'
        entry=(path,hashlib.sha256(fixture).hexdigest())
        g.REVIEWED_FIXTURES.add(entry)
        try:
            self.assertFalse(g.inspect(path,fixture))
            self.assertTrue(g.inspect(path,fixture+self.payload().encode()))
            self.assertTrue(g.inspect('other.test.ts',fixture))
        finally:g.REVIEWED_FIXTURES.remove(entry)
    def global_runtime(self):
        if sys.platform=='darwin':return self.home/'Library/Application Support/RepoShield/runtime'
        return self.home/'data/reposhield/runtime'
    def test_global_enable_covers_native_push_in_existing_repository(self):
        self.setup_remote();r=self.cli('enable');self.assertEqual(r.returncode,0,r.stderr)
        self.write('init',self.payload());self.commit('bad')
        r=self.git('push','origin','main',check=False)
        self.assertNotEqual(r.returncode,0);self.assertIn('RepoShield BLOCKED',r.stderr)
        self.assertFalse((self.repo/'.git/reposhield-install.json').exists())
        self.assertIn('ON',self.cli('status').stdout)
    def test_global_shim_automatically_handles_custom_repository_hooks(self):
        self.setup_remote();custom=self.repo/'.custom-hooks';custom.mkdir()
        marker=self.base/'previous-hook-ran'
        hook=custom/'pre-push';hook.write_text('#!/bin/sh\ntouch '+str(marker)+'\n');hook.chmod(0o700)
        self.git('config','core.hooksPath',str(custom))
        self.assertEqual(self.cli('enable').returncode,0)
        self.write('clean','safe');self.commit('clean')
        shim=self.global_runtime()/'bin/git'
        r=subprocess.run([str(shim),'-C',str(self.repo),'push','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertTrue(marker.exists())
        self.write('init',self.payload());self.commit('bad')
        r=subprocess.run([str(shim),'-C',str(self.repo),'push','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.cli('disable').returncode,0)
        self.assertEqual(self.git('config','--local','--get','core.hooksPath').stdout.strip(),str(custom))
    def test_global_enable_is_idempotent_and_restores_prior_global_hook(self):
        hooks=self.home/'old-hooks';hooks.mkdir()
        self.git('config','--global','core.hooksPath',str(hooks))
        self.assertEqual(self.cli('enable').returncode,0);self.assertEqual(self.cli('enable').returncode,0)
        profile=self.home/'.zshrc'
        if profile.exists():self.assertEqual(profile.read_text().count('# RepoShield global protection'),1)
        self.assertEqual(self.cli('disable').returncode,0)
        self.assertEqual(self.git('config','--global','--get','core.hooksPath').stdout.strip(),str(hooks))
        self.assertIn('OFF',self.cli('status').stdout)
    def test_global_disable_does_not_overwrite_external_git_change(self):
        self.assertEqual(self.cli('enable').returncode,0)
        self.git('config','--global','core.hooksPath','/external/hooks')
        self.assertNotEqual(self.cli('disable').returncode,0)
        self.assertEqual(self.git('config','--global','--get','core.hooksPath').stdout.strip(),'/external/hooks')
    def test_global_shim_blocks_infected_pull_without_repo_setup(self):
        clone=self.setup_remote();self.assertEqual(self.cli('enable').returncode,0)
        self.write('init',self.payload());self.commit('bad')
        # Test remote fixture upload explicitly bypasses the guard; the payload is never executed.
        self.git('-c','core.hooksPath=/dev/null','push','origin','main')
        shim=self.global_runtime()/'bin/git'
        r=subprocess.run([str(shim),'-C',str(clone),'pull','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0);self.assertFalse((clone/'init').exists())
    def test_legacy_install_migrates_and_global_disable_restores_original_hooks(self):
        self.setup_remote();self.assertEqual(self.cli('install','--runtime',str(self.base/'legacy')).returncode,0)
        self.assertEqual(self.cli('enable').returncode,0)
        shim=self.global_runtime()/'bin/git'
        self.write('clean','safe');self.commit('safe')
        r=subprocess.run([str(shim),'-C',str(self.repo),'push','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr)
        meta=json.loads((self.repo/'.git/reposhield-install.json').read_text())
        self.assertEqual(Path(meta['runtime']).resolve(),(self.global_runtime()/'reposhield_guard.py').resolve())
        self.assertEqual(self.cli('disable').returncode,0)
        self.assertNotEqual(self.git('config','--local','--get','core.hooksPath',check=False).returncode,0)
        self.assertEqual(self.cli('enable').returncode,0)
        r=subprocess.run([str(shim),'-C',str(self.repo),'push','origin','main'],env=self.env,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr)
    def test_global_enable_before_initializing_new_repository(self):
        self.assertEqual(self.cli('enable').returncode,0)
        fresh=self.base/'after-enable';fresh.mkdir()
        r=self.git('init','-b','main',cwd=fresh,check=False)
        self.assertEqual(r.returncode,0,r.stderr)
        (fresh/'README.md').write_text('safe\n')
        self.git('add','README.md',cwd=fresh)
        r=self.git('commit','-m','first',cwd=fresh,check=False)
        self.assertEqual(r.returncode,0,r.stderr)
        remote=self.base/'after-enable.git'
        r=self.git('init','--bare',str(remote),cwd=fresh,check=False)
        self.assertEqual(r.returncode,0,r.stderr)
        self.git('remote','add','origin',str(remote),cwd=fresh)
        (fresh/'init').write_text(self.payload())
        self.git('add','init',cwd=fresh);self.git('commit','-m','synthetic',cwd=fresh)
        r=self.git('push','origin','main',cwd=fresh,check=False)
        self.assertNotEqual(r.returncode,0);self.assertIn('RepoShield BLOCKED',r.stderr)
    def test_initialization_still_delegates_existing_template_hook(self):
        template=self.base/'template';(template/'hooks').mkdir(parents=True)
        marker=self.base/'init-hook-ran'
        hook=template/'hooks/reference-transaction'
        hook.write_text('#!/bin/sh\necho ran >> '+str(marker)+'\n');hook.chmod(0o700)
        self.assertEqual(self.cli('enable').returncode,0)
        fresh=self.base/'template-repo';fresh.mkdir()
        r=self.git('init','-b','main','--template='+str(template),cwd=fresh,check=False)
        self.assertEqual(r.returncode,0,r.stderr);self.assertTrue(marker.exists())
    def test_upgrade_removes_legacy_command_that_shadowed_npm(self):
        import shlex
        runtime=self.base/'runtime';(runtime/'bin').mkdir(parents=True)
        target=(runtime/'reposhield_guard.py').resolve()
        legacy=runtime/'bin/reposhield'
        legacy.write_text('#!/bin/sh\nexec /usr/bin/python3 -I -S -B '+shlex.quote(str(target))+'  "$@"\n')
        r=self.cli('install','--runtime',str(runtime))
        self.assertEqual(r.returncode,0,r.stderr);self.assertFalse(legacy.exists())
        self.assertTrue((runtime/'bin/git').exists())
    def test_refuses_runtime_in_repository(self):
        self.assertNotEqual(self.cli('install','--runtime',str(self.repo/'runtime')).returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
