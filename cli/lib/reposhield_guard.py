#!/usr/bin/python3
"""RepoShield local Git gate. Standard library only; never imports repository code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import uuid
import tempfile
from urllib.parse import urlencode, urlparse

GIT = '/usr/bin/git'
MAX_BLOB = 8 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_FILES = 30000
MAX_COMMITS = 500
ZERO = re.compile(r'^0+$')
HEX = re.compile(r'^[0-9a-f]{40}(?:[0-9a-f]{24})?$')
FONT_HEADERS = (b'wOFF', b'wOF2', b'OTTO', b'ttcf', b'\x00\x01\x00\x00')
# Manually reviewed inert scanner fixture. No path-wide/test-wide exclusions.
REVIEWED_FIXTURES = {('src/lib/scanner/pipeline.test.ts', 'ba95e5e38b9eba38bff161d400fce15c65e702b9db1f88f1f8465001b122d338')}


class Blocked(Exception):
    pass

class ThreatDetected(Blocked):
    pass

def explain_error(error):
    print('RepoShield BLOCKED: ' + str(error), file=sys.stderr)
    if isinstance(error, ThreatDetected):
        print('Reason: suspicious code matched the detection rules. Review the file, line, and cleanup instruction above.', file=sys.stderr)
    else:
        print('Reason: the operation could not be safely completed. This error does not establish whether malware is present.', file=sys.stderr)


def git(*args, cwd=None, check=True, data=None, hooks=False, extra_env=None):
    env = dict(os.environ, GIT_PAGER='cat', GIT_NO_REPLACE_OBJECTS='1', GIT_OPTIONAL_LOCKS='0')
    # Do not let inherited Git tracing write scanned content or credentials to logs.
    for k in list(env):
        if k.startswith('GIT_TRACE') or k in ('GIT_EXTERNAL_DIFF', 'GIT_DIFF_OPTS'):
            env.pop(k, None)
    if extra_env:env.update(extra_env)
    command = [GIT, '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never',
               '-c', 'submodule.recurse=false', '-c', 'core.pager=cat']
    if not hooks:
        command += ['-c', 'core.hooksPath=/dev/null']
    result = subprocess.run(command + list(args), cwd=cwd, env=env, input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if check and result.returncode:
        raise Blocked('Git operation failed; nothing approved. ' + result.stderr.decode('utf8', 'replace')[:600])
    return result

def root():
    return Path(git('rev-parse', '--show-toplevel').stdout.decode().strip())

def revision(ref):
    # Resolve once, then operate on immutable object IDs, never moving branch names.
    oid = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').stdout.decode().strip()
    if not HEX.fullmatch(oid):
        raise Blocked('Not a commit object ID.')
    return oid

def finding(path, raw, offset, rule, instruction):
    return {'path': path, 'line': raw[:offset].count(b'\n') + 1, 'rule': rule, 'instruction': instruction}

def inspect(path, raw):
    """Targeted campaign and execution-policy checks, not a malware clearance."""
    if (path, hashlib.sha256(raw).hexdigest()) in REVIEWED_FIXTURES:
        return []
    out = []
    name = Path(path).name.lower()
    ext = Path(path).suffix.lower()
    if ext in ('.woff', '.woff2', '.ttf', '.otf'):
        if raw[:4] not in FONT_HEADERS:
            out.append(finding(path, raw, 0, 'Invalid font header',
                'Quarantine this file. Restore a genuine font from its trusted upstream source; do not execute it.'))
        return out  # compressed font bytes are not JavaScript text
    if name in ('.npm-ws-runner.js', '.npm-ws.json', 'temp_auto_push.bat', 'temp_interactive_push.bat'):
        out.append(finding(path, raw, 0, 'Known persistence/propagation artifact',
            'Quarantine this artifact and check the host npm installation and running Node processes.'))
    if b'\x00' in raw[:4096]:
        return out
    executable = ext in ('.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.sh', '.bat', '.ps1') or '.' not in name
    if executable:
        for match in re.finditer(rb'[ \t]{50,}', raw):
            end = raw.find(b'\n', match.end())
            tail = raw[match.end():end if end >= 0 else len(raw)]
            if (len(tail) > 240 and re.match(rb'(?:var|let|const|global|\(?function|\(\(\))', tail)
                    and re.search(rb'NX|SX|_0x|eval\s*\(|Function\s*\(|global|child_process|v8\(', tail)):
                out.append(finding(path, raw, match.end(), 'Padding-hidden executable payload',
                    'Remove the appended payload after the long whitespace run, preserve legitimate code, and review the diff. Rescan before running any project command.'))
        marker = re.search(rb"(?m)^\s*global\s*(?:\.[io]|\[['\"](?:_V|!)['\"]\])\s*=", raw)
        if marker and re.search(rb'eval\s*\(|child_process|require\s*\(|\\u00', raw):
            out.append(finding(path, raw, marker.start(), 'Campaign loader marker',
                'Quarantine the script and restore a verified clean version. Rotate credentials exposed when it ran.'))
        loader = re.search(rb"(?m)^[^\n]*(?:\.npm-ws-runner\.js|M260630A)[^\n]*", raw)
        if loader and (b'cp.spawn' in raw or b'child_process' in raw):
            out.append(finding(path, raw, loader.start(), 'Hidden npm launcher',
                'Quarantine the modified npm installation and reinstall tools from a trusted distribution.'))
    if name == 'package.json':
        try:
            obj = json.loads(raw)
            scripts = obj.get('scripts', {})
            if not isinstance(scripts, dict):
                raise ValueError('scripts must be an object')
            for key, value in scripts.items():
                if isinstance(value, str) and re.search(r'\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba)?sh\b|\bnode\s+(?:\./)?api\.js\b|\b(?:powershell|pwsh)\b[^\n]*-(?:enc|encodedcommand)\b', value, re.I):
                    at = raw.find(json.dumps(key).encode())
                    out.append(finding(path, raw, max(0, at), 'Unsafe package script: ' + key,
                        'Remove the downloader segment from this script; inspect the referenced runner and rescan.'))
        except (ValueError, TypeError, AttributeError):
            out.append(finding(path, raw, 0, 'Unreadable package manifest', 'Repair package.json so its scripts can be inspected.'))
    if path.endswith('.vscode/tasks.json') and re.search(rb'"runOn"\s*:\s*"folderOpen"', raw):
        out.append(finding(path, raw, 0, 'Automatic folder-open task',
            'Disable runOn: folderOpen and inspect the command and every referenced file before allowing tasks.'))
    if name == '.gitattributes' and re.search(rb'(?m)^[^#\n]*\b(?:filter=|merge=(?!text\b|binary\b|union\b))', raw):
        out.append(finding(path, raw, 0, 'External Git attribute driver requires review',
            'Review filter/merge driver configuration. The guarded checkout does not run custom drivers.'))
    return out

def scan_commits(commits):
    seen = set()
    findings = []
    total = 0
    for commit in commits:
        if not HEX.fullmatch(commit):
            raise Blocked('Invalid commit ID.')
        tree = git('ls-tree', '-r', '-z', commit).stdout.split(b'\0')
        if len(tree) > MAX_FILES + 1:
            raise Blocked('File limit exceeded; scan incomplete.')
        for entry in tree:
            if not entry:
                continue
            info, path_bytes = entry.split(b'\t', 1)
            mode, kind, oid = info.decode().split()
            path = path_bytes.decode('utf8', 'replace')
            if mode == '160000':
                findings.append({'commit': commit, 'path': path, 'line': 1, 'rule': 'Unscanned submodule',
                    'instruction': 'Audit the pinned submodule separately; submodule checkout is blocked.'})
                continue
            key = (path, oid)
            if key in seen:
                continue
            seen.add(key)
            size = int(git('cat-file', '-s', oid).stdout)
            if size > MAX_BLOB or total + size > MAX_TOTAL:
                raise Blocked('Byte limit exceeded at ' + repr(path) + '; scan incomplete.')
            total += size
            raw = git('cat-file', 'blob', oid).stdout
            for item in inspect(path, raw):
                findings.append(dict(item, commit=commit))
    return findings

def approve(commits):
    findings = scan_commits(commits)
    if findings:
        for f in findings[:100]:
            # JSON escaping prevents malicious filenames from controlling the terminal.
            print(json.dumps(f, ensure_ascii=True), file=sys.stderr)
        raise ThreatDetected(str(len(findings)) + ' finding(s). No project code was run. Fix the listed files and rescan.')

def commit_range(old, new):
    revision(new)
    if old and not ZERO.fullmatch(old):
        revision(old)  # unavailable remote base blocks rather than approving a partial scan
        spec = old + '..' + new
    else:
        spec = new
    commits = git('rev-list', '--max-count=' + str(MAX_COMMITS + 1), spec, '--').stdout.decode().splitlines()
    if len(commits) > MAX_COMMITS:
        raise Blocked('Commit limit exceeded; scan incomplete. Audit/rewrite old history separately.')
    return list(dict.fromkeys([new] + commits))

def pre_push(remote=None, remote_url=None):
    for line in sys.stdin:
        parts = line.split()
        if len(parts) != 4:
            raise Blocked('Malformed pre-push input.')
        local_ref, local_oid, remote_ref, remote_oid = parts
        if ZERO.fullmatch(local_oid):
            continue  # branch deletion transfers no source
        if not HEX.fullmatch(local_oid) or not (HEX.fullmatch(remote_oid) or ZERO.fullmatch(remote_oid)):
            raise Blocked('Malformed pre-push object ID.')
        try:
            approve_outgoing(remote, remote_url, remote_oid, local_oid)
        except ThreatDetected:
            print('Push remains blocked. Automatic repair runs through the RepoShield Git wrapper before Git selects outgoing commits; configure your Git client to use that wrapper.', file=sys.stderr)
            raise
    print('RepoShield: outgoing revisions passed targeted checks.', file=sys.stderr)

def approve_outgoing(remote, remote_url, old, new):
    commits = commit_range(old, new)
    try:
        approve(commits)
        return
    except ThreatDetected:
        # A merge/new branch may reference infected history already published on
        # another remote branch. Never skip genuinely new snapshots on that basis.
        if not remote or remote not in git('remote').stdout.decode().splitlines():raise
        validate_transport(remote)
        fetch_url = git('remote', 'get-url', remote).stdout.decode().strip()
        push_url = git('remote', 'get-url', '--push', remote).stdout.decode().strip()
        if fetch_url != push_url or (remote_url and remote_url != push_url):
            raise Blocked('Cannot verify the existing history at this push destination; nothing approved.')
        namespace = 'refs/reposhield/push-baseline/' + uuid.uuid4().hex
        try:
            git('fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--refmap=', remote,
                'refs/heads/*:' + namespace + '/heads/*', 'refs/tags/*:' + namespace + '/tags/*')
            refs = git('for-each-ref', '--format=%(refname)', namespace + '/').stdout.decode().splitlines()
            if len(refs) > 1000:raise Blocked('Remote history verification exceeds the ref limit; nothing approved.')
            tips = []
            for ref in refs:
                peeled = git('rev-parse', '--verify', ref + '^{commit}', check=False)
                if peeled.returncode == 0:tips.append(peeled.stdout.decode().strip())
            if not tips:raise Blocked('No existing remote history could be verified; nothing approved.')
            novel = git('rev-list', '--max-count=' + str(MAX_COMMITS + 1), new, '--not', *tips, '--').stdout.decode().splitlines()
            if len(novel) > MAX_COMMITS:raise Blocked('Outgoing history limit exceeded; nothing approved.')
            approve(list(dict.fromkeys([new] + novel)))
            print('RepoShield: historical findings are already present on verified remote refs; the final tip and every newly uploaded commit passed targeted checks.', file=sys.stderr)
        finally:
            for line in git('for-each-ref', '--format=%(refname) %(objectname)', namespace + '/').stdout.decode().splitlines():
                ref, oid = line.split();git('update-ref', '-d', ref, oid, check=False)

def validate_transport(remote):
    url = git('remote', 'get-url', remote).stdout.decode().strip()
    if not (url.startswith(('https://', 'ssh://', 'git@', 'file://', '/'))):
        raise Blocked('Unsupported remote transport; only HTTPS, SSH and local/file remotes are allowed.')
    for key in ('core.sshCommand', 'remote.' + remote + '.uploadpack', 'remote.' + remote + '.receivepack', 'remote.' + remote + '.vcs'):
        if git('config', '--get', key, check=False).returncode == 0:
            raise Blocked('Custom Git transport command requires review: ' + key)
    if any(os.environ.get(key) for key in ('GIT_SSH', 'GIT_SSH_COMMAND')):
        raise Blocked('Custom SSH command environment requires review before guarded pull.')
    helpers = git('config', '--get-all', 'credential.helper', check=False).stdout.decode().splitlines()
    if any(h.lstrip().startswith('!') for h in helpers):
        raise Blocked('Shell credential helper requires review before guarded pull.')

def safe_checkout(repo, old):
    info_attrs = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'info/attributes').stdout.decode().strip())
    attrs_file = git('config', '--path', '--get', 'core.attributesFile', check=False).stdout.decode().strip()
    for attrs in [info_attrs] + ([Path(attrs_file).expanduser()] if attrs_file else []):
        if attrs.exists() and inspect('.gitattributes', attrs.read_bytes()):
            raise Blocked('Custom local/global Git attribute drivers require review before pull.')
    # Inspect current tracked attributes before status can invoke a configured clean filter.
    for attrs in repo.rglob('.gitattributes'):
        if '.git' not in attrs.relative_to(repo).parts and inspect('.gitattributes', attrs.read_bytes()):
            raise Blocked('Working-tree Git attribute drivers require review before pull.')
    current_attrs = git('show', old + ':.gitattributes', check=False)
    if current_attrs.returncode == 0 and inspect('.gitattributes', current_attrs.stdout):
        raise Blocked('Current checkout requests custom attribute drivers; review before pull.')

def guarded_pull(remote, branch, include_tags=False, expected_new=None):
    repo = root()
    # Limit the command to explicit named remotes and full branch names, not arbitrary refspecs/options.
    remotes = git('remote').stdout.decode().splitlines()
    if remote not in remotes or remote.startswith('-'):
        raise Blocked('Choose a configured remote name.')
    if git('check-ref-format', 'refs/heads/' + branch, check=False).returncode:
        raise Blocked('Invalid branch name.')
    validate_transport(remote)
    old = revision('HEAD')
    safe_checkout(repo, old)
    if git('status', '--porcelain', '--untracked-files=all').stdout:
        raise Blocked('Working tree must be clean before guarded pull. Commit or safely stash your work first.')
    namespace = 'refs/reposhield/incoming/' + uuid.uuid4().hex
    private_ref = namespace + '/branch'
    promoted = []
    completed = False
    try:
        refspecs = ['refs/heads/' + branch + ':' + private_ref]
        if include_tags:
            refspecs.append('refs/tags/*:' + namespace + '/tags/*')
        git('fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--refmap=',
            remote, *refspecs)
        new = revision(private_ref)
        if expected_new and new != expected_new:
            raise Blocked('The remote changed during cleanup synchronization. Retry the push to inspect the new revision.')
        commits = [old] + commit_range(old, new)
        tags = []
        tag_commits = []
        staged = git('for-each-ref', '--format=%(refname) %(objectname)', namespace + '/tags/').stdout.decode().splitlines()
        if len(staged) > 200:
            raise Blocked('More than 200 tags requested; scan incomplete. Retry git pull --no-tags ' + remote + ' ' + branch + ' and review tags separately.')
        for line in staged:
            ref, oid = line.split()
            public = 'refs/tags/' + ref[len(namespace + '/tags/'):]
            existing = git('show-ref', '--verify', '--hash', public, check=False).stdout.decode().strip()
            if existing == oid:
                continue
            if existing:
                raise Blocked('Tag conflict at ' + repr(public) + '. The remote tag differs from your local tag. Review the tag before retrying; no tags were overwritten.')
            peeled = git('rev-parse', '--verify', ref + '^{commit}', check=False)
            if peeled.returncode:
                raise Blocked('Tag ' + repr(public) + ' points to a non-commit object that this scanner cannot approve. Review it separately or retry with --no-tags.')
            tag_history = commit_range(None, peeled.stdout.decode().strip())
            tag_commits.extend(tag_history)
            commits.extend(tag_history)
            tags.append((public, oid))
        commits = list(dict.fromkeys(commits))
        if len(commits) > MAX_COMMITS:
            raise Blocked('Combined branch/tag history exceeds the scan limit. Retry with --no-tags and review tag history separately.')
        try:
            approve_pull(old, new, commit_range(old, new))
            if tag_commits:approve(tag_commits)
        except ThreatDetected:
            if repair_enabled():pull_handoff(remote, branch, new)
            raise
        ahead_only = git('merge-base', '--is-ancestor', new, old, check=False).returncode == 0
        if not ahead_only and git('merge-base', '--is-ancestor', old, new, check=False).returncode:
            raise Blocked('Your local and remote branches have diverged. RepoShield only applies fast-forward pulls. Review both branches before merging/rebasing.')
        if revision('HEAD') != old or git('status', '--porcelain', '--untracked-files=all').stdout:
            raise Blocked('Repository changed during inspection; rerun the guarded pull.')
        if tags:
            transaction = 'start\n' + ''.join('create ' + ref + ' ' + oid + '\n' for ref, oid in tags) + 'prepare\ncommit\n'
            git('update-ref', '--stdin', data=transaction.encode())
            promoted = tags
        git('merge', '--ff-only', '--no-edit', '--no-autostash', new)
        if revision('HEAD') != (old if ahead_only else new):
            raise Blocked('Unexpected final HEAD; investigate concurrent Git activity.')
        completed = True
        print('RepoShield: branch' + (' and requested tags' if include_tags else '') + (' passed targeted checks; already up to date. Local commits remain ready to push.' if ahead_only else ' passed targeted checks; fast-forward pull completed.'))
    finally:
        if not completed:
            for ref, oid in promoted:
                git('update-ref', '-d', ref, oid, check=False)
        for line in git('for-each-ref', '--format=%(refname) %(objectname)', namespace + '/').stdout.decode().splitlines():
            ref, oid = line.split()
            git('update-ref', '-d', ref, oid, check=False)

REPAIR_MARKER = b'RepoShield-Repair: padding-tail-v1'
# Byte hashes of the payload tails confirmed during this incident, not whole-file exemptions.
KNOWN_TAIL_HASHES = ['0a54556284424834a5acf31d8a1e89f9a110962e4b9e1ca8d713b8bda096fdfe', '2ccc5171a550509f78202054cceec2bc866f58a74adf1c865434e78ef7481b34', '905721f48f5d13ced9e88a999b5c1d758f7ed3152acc1e04549b835dc79d7fea']

def repair_enabled():
    state = global_state()
    return bool(state and state.get('enabled') and state.get('repair_enabled'))

def configure_repair(args):
    if args not in (['on'], ['off'], ['status']):
        raise Blocked('Usage: reposhield repair on|off|status. Enables known-payload repair for private outgoing history and browser handoff for blocked GitHub pulls.')
    state = global_state()
    if not state or not state.get('enabled'):
        raise Blocked('Run reposhield enable before configuring repair.')
    if args != ['status']:
        state['repair_enabled'] = args == ['on'];save_global(state)
    print('RepoShield automatic repair: ' + ('on' if state.get('repair_enabled') else 'off'))
    print('Push: supported payloads in unshared linear commits only; recovery refs retained. Pull: open the authenticated web repair page; review before changing GitHub.')

def repair_blob(path, raw):
    """A single, deliberately narrow byte-preserving repair contract shared with the web app."""
    findings = inspect(path, raw)
    if not findings:return raw
    if any(f['rule'] not in ('Padding-hidden executable payload', 'Campaign loader marker') for f in findings):
        raise Blocked('No automatic repair rule for ' + repr(path) + '. Review the reported file and line manually.')
    edits = []
    for match in re.finditer(rb'[ \t]{50,}', raw):
        end = raw.find(b'\n', match.end())
        if end < 0:end = len(raw)
        tail = raw[match.end():end].rstrip(b'\r')
        # Do not treat generic whitespace/obfuscation heuristics as permission to delete code.
        known_tail = hashlib.sha256(tail).hexdigest() in KNOWN_TAIL_HASHES
        if known_tail or (b'var NX,SX,spin,splitLane,peel;' in tail and len(tail) > 240
                and re.match(rb'(?:var|let|const)', tail)
                and tail.endswith((b'})(global,require);', b'}(global,require)})()'))):
            prefix = raw[:match.start()].split(b'\n')[-1].rstrip(b'\r')
            if prefix.strip() and not prefix.rstrip().endswith((b';', b'}', b');')):
                raise Blocked('Ambiguous legitimate prefix in ' + repr(path) + '; manual repair required.')
            edits.append((match.start(), end, b'\r' if raw[match.end():end].endswith(b'\r') else b''))
    after = raw
    for start, end, newline in reversed(edits):after = after[:start] + newline + after[end:]
    if after == raw or inspect(path, after):
        raise Blocked('The payload in ' + repr(path) + ' is outside the tested repair rule. Nothing was changed; review manually.')
    return after

def tree_entries(commit):
    result = {}
    for entry in git('ls-tree', '-r', '-z', commit).stdout.split(b'\0'):
        if not entry:continue
        meta, path = entry.split(b'\t', 1);mode, kind, oid = meta.split()
        result[path.decode('utf8', 'surrogateescape')] = (mode, kind, oid.decode())
    if len(result) > MAX_FILES:raise Blocked('Tree exceeds the repair file limit.')
    return result

def repair_tree(commit):
    entries = tree_entries(commit);edits = [];total = 0
    for path, (mode, kind, oid) in entries.items():
        if kind != b'blob':
            raise Blocked('Submodules cannot be automatically repaired.')
        size = int(git('cat-file', '-s', oid).stdout);total += size
        if size > MAX_BLOB or total > MAX_TOTAL:raise Blocked('Repair scan limit exceeded; nothing changed.')
        raw = git('cat-file', 'blob', oid).stdout
        after = repair_blob(path, raw)
        if after != raw:
            if mode not in (b'100644', b'100755'):raise Blocked('Non-regular file needs manual repair: ' + repr(path))
            replacement = git('hash-object', '-w', '--stdin', data=after).stdout.strip()
            edits.append((path, mode, replacement))
    if not edits:return git('rev-parse', commit + '^{tree}').stdout.decode().strip(), []
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.decode().strip())
    with tempfile.TemporaryDirectory(prefix='reposhield-index-', dir=common) as directory:
        env = {'GIT_INDEX_FILE': str(Path(directory) / 'index')}
        git('read-tree', commit, extra_env=env)
        data = b''.join(mode + b' ' + oid + b'\t' + path.encode('utf8', 'surrogateescape') + b'\0' for path, mode, oid in edits)
        git('update-index', '-z', '--index-info', data=data, extra_env=env)
        tree = git('write-tree', extra_env=env).stdout.decode().strip()
    return tree, [p for p, _, _ in edits]

def verified_repair(commit, require_marker=True):
    """Recompute every changed byte; legacy receipts are optional for verified cleanups."""
    raw = git('cat-file', 'commit', commit).stdout
    header, _, message = raw.partition(b'\n\n')
    parents = [line[7:].decode() for line in header.splitlines() if line.startswith(b'parent ')]
    if len(parents) != 1 or (require_marker and REPAIR_MARKER not in message.splitlines()):return None
    parent = parents[0]
    try:tree, paths = repair_tree(parent)
    except Blocked:return None
    if not paths:return None
    entries = tree_entries(parent)
    if tree != git('rev-parse', commit + '^{tree}').stdout.decode().strip():
        if require_marker:return None
        # Older dashboard cleanups appended a blank line. Permit only that
        # byte-level difference, with every other file and mode unchanged.
        after = tree_entries(commit)
        if entries.keys() != after.keys():return None
        for path, entry in entries.items():
            current = after[path]
            if path not in paths:
                if entry != current:return None
                continue
            if entry[:2] != current[:2]:return None
            expected = repair_blob(path, git('cat-file', 'blob', entry[2]).stdout)
            actual = git('cat-file', 'blob', current[2]).stdout
            if actual not in (expected, expected + b'\n', expected + b'\r\n'):return None
    return parent, {(path, entries[path][2]) for path in paths}

def approve_pull(old, new, commits):
    # A previously infected checkout may advance to an exactly verified repair.
    # The final snapshot must pass independently before any worktree update.
    approve([new])
    findings = scan_commits(list(dict.fromkeys([old] + commits)))
    if not findings:return
    verified = []
    for commit in commits:
        repair = verified_repair(commit, require_marker=False)
        if repair and git('merge-base', '--is-ancestor', commit, new, check=False).returncode == 0:
            verified.append(repair)
    remaining = []
    for item in findings:
        entry = tree_entries(item['commit']).get(item['path'])
        if not entry or not any((item['path'], entry[2]) in repaired and
                git('merge-base', '--is-ancestor', item['commit'], parent, check=False).returncode == 0
                for parent, repaired in verified):
            remaining.append(item)
    if remaining:
        for item in remaining[:100]:print(json.dumps(item, ensure_ascii=True), file=sys.stderr)
        raise ThreatDetected(str(len(remaining)) + ' unresolved historical finding(s). Pull blocked; repair the remote branch or review the affected tags. No project code was run.')
    print('RepoShield: historical payloads have an exact, locally verified repair commit. Infected history remains in Git; only the inspected final snapshot will be checked out.')

def pull_handoff(remote, branch, head):
    url = git('remote', 'get-url', remote).stdout.decode().strip()
    match = re.fullmatch(r'(?:https://github\.com/|ssh://git@github\.com/|git@github\.com:)([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?', url)
    if not match:
        print('Web repair handoff supports github.com remotes. Use the file instructions above for this remote.', file=sys.stderr);return
    owner, repo = match.groups()
    link = 'https://reposhield.imranwebstudio.me/guard/pull?' + urlencode({'owner': owner, 'repo': repo, 'branch': branch, 'head': head})
    print('Pull paused. Open RepoShield to inspect this exact branch and prepare its repair:', file=sys.stderr)
    print(link, file=sys.stderr)
    print('After the repair is committed/merged, retry this pull. The CLI independently verifies the repair and scans the final snapshot. Tags are reviewed separately.', file=sys.stderr)
    if not os.environ.get('REPOSHIELD_NO_BROWSER'):
        opener = '/usr/bin/open' if sys.platform == 'darwin' else '/usr/bin/xdg-open'
        if Path(opener).is_file():
            try:subprocess.run([opener, link], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            except (OSError, subprocess.TimeoutExpired):pass

def verified_cleanup_fork(head, remote_head):
    """Allow synchronization only when every remote-only commit is an exact repair."""
    bases = git('merge-base', '--all', head, remote_head, check=False).stdout.decode().splitlines()
    if len(bases) != 1:
        raise Blocked('Branches do not have one unambiguous common base. Review the divergence manually; nothing changed.')
    common = bases[0]
    commits = git('rev-list', '--reverse', '--topo-order', '--max-count=21', common + '..' + remote_head, '--').stdout.decode().splitlines()
    if not commits or len(commits) > 20:
        raise Blocked('Remote history is outside the verified cleanup sync limit. Pull and review it before pushing.')
    previous = common
    for commit in commits:
        repair = verified_repair(commit, require_marker=False)
        if not repair or repair[0] != previous:
            raise Blocked('The remote contains changes beyond an exact supported web cleanup. Review and integrate those changes before pushing; nothing was rewritten.')
        previous = commit
    if previous != remote_head:
        raise Blocked('The remote cleanup history is not linear. Review it manually before pushing.')
    approve([remote_head])
    return common

def auto_repair_push(arguments):
    # Native pre-push remains authoritative for complex/multiple refspecs.
    positional = [a for a in arguments if a not in ('-u', '--set-upstream', '--progress', '--porcelain', '--verbose', '-v', '--quiet', '-q')]
    if any(a.startswith('-') for a in positional) or len(positional) > 2:return
    branch_ref = git('symbolic-ref', '--quiet', 'HEAD', check=False).stdout.decode().strip()
    if not branch_ref.startswith('refs/heads/'):return
    branch = branch_ref[len('refs/heads/'):]
    remote = positional[0] if positional else git('config', '--get', 'branch.' + branch + '.remote', check=False).stdout.decode().strip()
    if remote not in git('remote').stdout.decode().splitlines():return
    spec = positional[1] if len(positional) == 2 else branch
    parts = spec.split(':')
    if len(parts) > 2 or parts[0] not in (branch, branch_ref, 'HEAD'):return
    destination = parts[-1] if len(parts) == 2 else branch
    if destination.startswith('refs/heads/'):destination = destination[len('refs/heads/'):]
    if git('check-ref-format', 'refs/heads/' + destination, check=False).returncode:return
    if len(positional) < 2:
        default = git('config', '--get', 'push.default', check=False).stdout.decode().strip()
        if default not in ('', 'simple', 'current'):return
        if git('config', '--get-all', 'remote.' + remote + '.push', check=False).returncode == 0:return
        pushremote = git('config', '--get', 'remote.pushDefault', check=False).stdout.decode().strip()
        branchremote = git('config', '--get', 'branch.' + branch + '.pushRemote', check=False).stdout.decode().strip()
        if not positional and (pushremote or branchremote):return
        upstream = git('config', '--get', 'branch.' + branch + '.merge', check=False).stdout.decode().strip()
        if default != 'current' and upstream != 'refs/heads/' + branch:return
    validate_transport(remote)
    if git('remote', 'get-url', '--push', remote).stdout != git('remote', 'get-url', remote).stdout:
        raise Blocked('Push/fetch URLs differ; automatic repair needs a reviewed single destination.')
    repo = root();head = revision('HEAD');safe_checkout(repo, head)
    if git('status', '--porcelain', '--untracked-files=all').stdout:
        raise Blocked('Automatic push repair requires a clean checkout. Commit or safely stash your work, then retry.')
    namespace = 'refs/reposhield/push-inspection/' + uuid.uuid4().hex
    try:
        git('fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--refmap=', remote,
            'refs/heads/*:' + namespace + '/heads/*', 'refs/tags/*:' + namespace + '/tags/*')
        base_result = git('rev-parse', '--verify', namespace + '/heads/' + destination, check=False)
        base = base_result.stdout.decode().strip() if base_result.returncode == 0 else None
        local_base = base
        sync_cleanup = False
        if base and git('merge-base', '--is-ancestor', base, head, check=False).returncode:
            local_base = verified_cleanup_fork(head, base)
            if local_base == head:
                guarded_pull(remote, destination, expected_new=base)
                print('RepoShield: synchronized the verified web cleanup into your local checkout. Continuing the push.', file=sys.stderr)
                return
            sync_cleanup = True
        outgoing = commit_range(local_base, head)
        findings = scan_commits(outgoing)
        if not findings and not sync_cleanup:return
        if sync_cleanup:print('RepoShield: synchronizing an exact web cleanup with private local commits.', file=sys.stderr)
        print('RepoShield: checking findings for supported private-history repair:', file=sys.stderr)
        for item in findings[:100]:print(json.dumps(item, ensure_ascii=True), file=sys.stderr)
        if base:approve([base])
        commits = git('rev-list', '--reverse', '--topo-order', (local_base + '..' if local_base else '') + head, '--').stdout.decode().splitlines()
        affected = set(commits)  # Every rewritten parent/descendant must be unshared, even when blob findings were deduplicated.
        for bad in affected:
            other_refs = git('for-each-ref', '--format=%(refname)', '--contains=' + bad, 'refs/heads/', 'refs/tags/').stdout.decode().splitlines()
            if any(ref != branch_ref for ref in other_refs):
                raise Blocked('An affected commit is referenced by another local branch or tag. Review shared history manually; nothing changed.')
        remote_tips = git('for-each-ref', '--format=%(objectname)', namespace + '/').stdout.decode().splitlines()
        if len(remote_tips) > 1000:raise Blocked('Too many remote refs to establish private history; review manually.')
        for bad in affected:
            for tip in remote_tips:
                commit = git('rev-parse', '--verify', tip + '^{commit}', check=False)
                if commit.returncode == 0 and git('merge-base', '--is-ancestor', bad, commit.stdout.decode().strip(), check=False).returncode == 0:
                    raise Blocked('An affected commit is already published on the remote. Automatic repair will not rewrite shared history. Repair that branch in the web app or review a history rewrite.')
        rewritten = {local_base: base} if sync_cleanup else {}
        changes = []
        for commit in commits:
            raw = git('cat-file', 'commit', commit).stdout
            header, separator, message = raw.partition(b'\n\n')
            lines = header.splitlines();parents = [line[7:].decode() for line in lines if line.startswith(b'parent ')]
            if len(parents) > 1 or any(line.startswith((b'gpgsig', b'mergetag')) for line in lines):
                raise Blocked('Merge or signed commits require manual review; automatic repair has not changed your branch.')
            tree, paths = repair_tree(commit)
            next_lines = []
            for line in lines:
                if line.startswith(b'tree '):line = b'tree ' + tree.encode()
                elif line.startswith(b'parent '):line = b'parent ' + rewritten.get(line[7:].decode(), line[7:].decode()).encode()
                next_lines.append(line)
            replacement = b'\n'.join(next_lines) + separator + message
            oid = git('hash-object', '-t', 'commit', '-w', '--stdin', data=replacement).stdout.decode().strip()
            rewritten[commit] = oid
            changes.extend((commit, path) for path in paths)
        repaired = rewritten.get(head, head)
        approve(commit_range(base, repaired))
        if revision('HEAD') != head or git('status', '--porcelain', '--untracked-files=all').stdout:
            raise Blocked('Checkout changed during repair; branch left untouched. Retry when idle.')
        backup = 'refs/reposhield/recovery/' + uuid.uuid4().hex
        git('update-ref', backup, head, '0' * len(head))
        # read-tree -u checks that tracked files are unchanged; it does not run checkout hooks.
        git('read-tree', '-m', '-u', head, repaired)
        try:git('update-ref', branch_ref, repaired, head)
        except Blocked:
            git('read-tree', '-m', '-u', repaired, head, check=False)
            raise
        if sync_cleanup:
            print('RepoShield: verified web cleanup synchronized; preserved ' + str(len(commits)) + ' private local commit(s). Outgoing commits passed targeted checks.', file=sys.stderr)
        else:
            print('RepoShield: recognized payloads removed; outgoing commits passed targeted checks.', file=sys.stderr)
        for commit, path in changes:print('  ' + json.dumps(path) + ' (previous commit ' + commit[:12] + ')', file=sys.stderr)
        print('Recovery reference: ' + backup + '. Continuing the original push; its hooks will scan the actual outgoing refs again.', file=sys.stderr)
    finally:
        for line in git('for-each-ref', '--format=%(refname) %(objectname)', namespace + '/').stdout.decode().splitlines():
            ref, oid = line.split();git('update-ref', '-d', ref, oid, check=False)

def install(runtime):
    repo = root()
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.decode().strip())
    runtime = Path(runtime).resolve()
    if runtime == repo or repo in runtime.parents:
        raise Blocked('Runtime must be outside the protected checkout so a pull cannot overwrite the guard.')
    target = write_runtime(runtime)
    hooks = common / 'reposhield-hooks';config = common / 'reposhield-install.json'
    existing = git('config','--local','--get','core.hooksPath',check=False,hooks=True).stdout.decode().strip()
    if config.exists():
        saved=json.loads(config.read_text())
        expected=saved.get('previous_local_hooks_path') or ''
        if existing != str(hooks) and not (saved.get('disabled') and existing == expected):
            raise Blocked('Installation changed; inspect it before reinstalling.')
        previous=Path(saved['previous_hooks'])
        previous_setting=saved.get('previous_local_hooks_path')
    else:
        if hooks.exists():raise Blocked('Unrecognized existing guard hook directory.')
        previous=Path(git('rev-parse','--path-format=absolute','--git-path','hooks',hooks=True).stdout.decode().strip())
        previous_setting=existing or None
    hooks.mkdir(mode=0o700,exist_ok=True)
    for name in HOOK_NAMES:
        old=previous/name
        content='#!/bin/sh\n'
        if name=='pre-push':
            content+='umask 077\ntmp=$(/usr/bin/mktemp) || exit 1\ntrap \'/bin/rm -f "$tmp"\' EXIT HUP INT TERM\n/bin/cat > "$tmp" || exit 1\n'
            content+='/usr/bin/python3 -I -S -B '+shlex.quote(str(target))+' pre-push "$@" < "$tmp" || exit $?\n'
            if old.is_file() and os.access(old,os.X_OK):content+=shlex.quote(str(old))+' "$@" < "$tmp"\nexit $?\n'
        elif old.is_file() and os.access(old,os.X_OK):content+='exec '+shlex.quote(str(old))+' "$@"\n'
        file=hooks/name;file.write_text(content);file.chmod(0o700)
    config.write_text(json.dumps({'previous_local_hooks_path':previous_setting,'previous_hooks':str(previous),
        'runtime':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'disabled':False},indent=2))
    git('config','--local','core.hooksPath',str(hooks))
    register_repository(repo)
    print('Installed pre-push gate: '+str(repo))



# Global protection is scoped to the current OS account, like npm -g with a user prefix.
VERSION = '0.3.2'
HOOK_NAMES = ['applypatch-msg','pre-applypatch','post-applypatch','pre-commit','pre-merge-commit',
    'prepare-commit-msg','commit-msg','post-commit','pre-rebase','post-checkout','post-merge',
    'pre-push','pre-auto-gc','post-rewrite','sendemail-validate','reference-transaction',
    'pre-receive','update','post-receive','post-update','push-to-checkout','proc-receive']

def global_home():
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/RepoShield'
    return Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'reposhield'

def global_state():
    p = global_home() / 'state.json'
    return json.loads(p.read_text()) if p.exists() else None

def save_global(state):
    home = global_home();home.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = home / ('state-' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(state, indent=2));tmp.chmod(0o600)
    os.replace(tmp, home / 'state.json')

def register_repository(repo):
    state = global_state()
    if not state or not state.get('enabled'):
        return
    import fcntl
    with (global_home() / 'state.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = global_state()
        if str(repo) not in state['repositories']:
            state['repositories'].append(str(repo));save_global(state)

def write_runtime(runtime):
    runtime = Path(runtime).resolve();runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = runtime / 'reposhield_guard.py'
    if Path(__file__).resolve() != target:
        tmp = runtime / ('guard-' + uuid.uuid4().hex + '.tmp')
        shutil.copyfile(Path(__file__).resolve(), tmp);tmp.chmod(0o700);os.replace(tmp, target)
    bindir = runtime / 'bin';bindir.mkdir(exist_ok=True)
    # Keep the reposhield command owned by npm, so npm upgrades do not stay
    # shadowed by an older runtime launcher earlier on PATH.
    legacy = bindir / 'reposhield'
    if legacy.exists():
        expected = '#!/bin/sh\nexec /usr/bin/python3 -I -S -B ' + shlex.quote(str(target)) + '  "$@"\n'
        if legacy.read_text() != expected:
            raise Blocked('Unrecognized reposhield launcher in runtime/bin; review it before upgrading.')
        legacy.unlink()
    for name, action in [('git', 'git-proxy')]:
        p = bindir / name
        p.write_text('#!/bin/sh\nexec /usr/bin/python3 -I -S -B ' + shlex.quote(str(target)) + ' ' + action + ' "$@"\n')
        p.chmod(0o700)
    return target

def global_hook(name, arguments):
    state = global_state()
    data = None
    if name == 'pre-push':
        data = sys.stdin.buffer.read()
        if state and state.get('enabled'):
            import io
            sys.stdin = io.StringIO(data.decode('utf8', 'strict'))
            pre_push(arguments[0] if arguments else None, arguments[1] if len(arguments) > 1 else None)
    if not state:
        raise Blocked('Global installation metadata is missing.')
    previous = state.get('previous_global_hooks')
    if previous:
        old = Path(previous).expanduser()
        if not old.is_absolute():old = Path.cwd() / old
    else:
        resolved = git('rev-parse', '--path-format=absolute', '--git-common-dir', check=False)
        if resolved.returncode == 0:
            common = Path(resolved.stdout.decode().strip())
        else:
            # reference-transaction can run while git init creates HEAD, before
            # rev-parse recognizes a complete repository. Preserve template hooks
            # using Git's own hook environment without requiring an existing HEAD.
            directory = os.environ.get('GIT_COMMON_DIR') or os.environ.get('GIT_DIR')
            if not directory or not Path(directory).is_dir():
                if name == 'pre-push':
                    raise Blocked('Cannot resolve Git directory for push hook; nothing approved.')
                return 0
            common = Path(directory).resolve()
            shared = common / 'commondir'
            if not os.environ.get('GIT_COMMON_DIR') and shared.is_file():
                common = (common / shared.read_text().strip()).resolve()
        old = common / 'hooks'
    hook = old / name
    managed = Path(state['runtime']) / 'hooks' / name
    if hook.resolve() == managed.resolve():
        raise Blocked('Recursive hook configuration.')
    if hook.is_file() and os.access(hook, os.X_OK):
        result = subprocess.run([str(hook)] + arguments, input=data)
        return result.returncode
    return 0

def enable_global():
    if sys.platform not in ('darwin', 'linux'):
        raise Blocked('Global installation currently supports macOS and Linux.')
    runtime = global_home() / 'runtime'
    repo = git('rev-parse', '--show-toplevel', check=False)
    if repo.returncode == 0:
        path = Path(repo.stdout.decode().strip())
        if path == runtime or path in runtime.parents:
            raise Blocked('Global runtime must not live inside a Git checkout.')
    state = global_state()
    active = git('config', '--global', '--get', 'core.hooksPath', check=False, hooks=True).stdout.decode().strip()
    if state and state.get('enabled') and active != str(runtime / 'hooks'):
        raise Blocked('Global hooks changed outside RepoShield; review before enabling again.')
    if not state or not state.get('enabled'):
        state = {'version': VERSION, 'enabled': True, 'runtime': str(runtime),
            'previous_global_hooks': active or None, 'repositories': [], 'profiles': {}, 'editors': {}}
    target = write_runtime(runtime)
    hooks = runtime / 'hooks';hooks.mkdir(exist_ok=True)
    for name in HOOK_NAMES:
        p = hooks / name
        p.write_text('#!/bin/sh\nexec /usr/bin/python3 -I -S -B ' + shlex.quote(str(target)) +
            ' global-hook ' + shlex.quote(name) + ' "$@"\n');p.chmod(0o700)
    # Record rollback information before changing Git or shell settings.
    save_global(state)
    git('config', '--global', 'core.hooksPath', str(hooks))
    start = '# RepoShield global protection'
    end = '# End RepoShield global protection'
    block = start + '\nexport PATH=' + shlex.quote(str(runtime / 'bin')) + ':"$PATH"\n' + end
    login_profile=Path.home()/'.bash_profile'
    if not login_profile.exists():login_profile=Path.home()/'.profile'
    for profile in (Path.home()/'.zshrc', Path.home()/'.zprofile', Path.home()/'.bashrc', login_profile):
        # Configure zsh on macOS; configure both existing shells on Linux.
        if sys.platform == 'darwin' and profile.name in ('.bashrc','.bash_profile','.profile') and not profile.exists():continue
        original = profile.read_text() if profile.exists() else ''
        if str(profile) not in state['profiles']:
            state['profiles'][str(profile)] = {'existed':profile.exists()}
        text = re.sub(r'(?m)^# RepoShield guarded Git \(pull/push\)\n.*?^# End RepoShield guarded Git\n?', '', original, flags=re.S)
        text = re.sub(r'(?m)^# RepoShield global protection\n.*?^# End RepoShield global protection\n?', '', text, flags=re.S)
        profile.write_text(text.rstrip() + '\n\n' + block + '\n')
    if sys.platform == 'darwin':
        for app in ('Cursor','Code'):
            p = Path.home()/'Library/Application Support'/app/'User/settings.json'
            if not p.exists():continue
            text = p.read_text()
            try:d = json.loads(text)
            except ValueError:
                print('Editor JSONC settings left intact; set git.path manually to ' + str(runtime/'bin/git'), file=sys.stderr);continue
            if str(p) not in state['editors']:
                old = d.get('git.path')
                if isinstance(old,str) and '/outputs/reposhield-runtime/bin/git' in old:old = None
                state['editors'][str(p)] = old
            d['git.path'] = str(runtime/'bin/git');p.write_text(json.dumps(d,indent=2)+'\n')
    state['enabled'] = True;state['version'] = VERSION;save_global(state)
    print('RepoShield global protection enabled for this OS account.')
    print('New and existing repositories are guarded through normal git pull/push. No per-repository install command is needed.')
    print('Open a new terminal and reload your editor. Run reposhield status to verify.')
    print('Absolute Git binaries, clients using another Git, --no-verify and explicit hook overrides can bypass client-side protection.')

def disable_global():
    state = global_state()
    if not state or not state.get('enabled'):
        print('RepoShield global protection is already disabled.');return
    runtime = Path(state['runtime'])
    active = git('config','--global','--get','core.hooksPath',check=False,hooks=True).stdout.decode().strip()
    if active != str(runtime/'hooks'):
        raise Blocked('Global hooks changed outside RepoShield; refusing to overwrite them.')
    previous = state.get('previous_global_hooks')
    if previous is None:git('config','--global','--unset-all','core.hooksPath',check=False)
    else:git('config','--global','core.hooksPath',previous)
    warnings = []
    for path in state['repositories']:
        try:
            repo = Path(path)
            common = Path(git('-C',str(repo),'rev-parse','--path-format=absolute','--git-common-dir').stdout.decode().strip())
            meta = common/'reposhield-install.json'
            if not meta.exists():continue
            info = json.loads(meta.read_text());managed = str(common/'reposhield-hooks')
            local = git('-C',str(repo),'config','--local','--get','core.hooksPath',check=False,hooks=True).stdout.decode().strip()
            if local != managed:
                warnings.append(str(repo) + ': hooks changed externally; left intact');continue
            old = info.get('previous_local_hooks_path')
            if old is None:git('-C',str(repo),'config','--local','--unset-all','core.hooksPath',check=False)
            else:git('-C',str(repo),'config','--local','core.hooksPath',old)
            info['disabled'] = True;meta.write_text(json.dumps(info,indent=2))
        except (OSError,ValueError,Blocked) as error:warnings.append(str(path)+': '+str(error))
    for path in state['profiles']:
        p=Path(path)
        if not p.exists():continue
        text=p.read_text()
        text=re.sub(r'(?m)^# RepoShield global protection\n.*?^# End RepoShield global protection\n?', '', text, flags=re.S)
        if not state['profiles'][path]['existed'] and not text.strip():p.unlink()
        else:p.write_text(text)
    for path, old in state['editors'].items():
        p=Path(path)
        if not p.exists():continue
        try:d=json.loads(p.read_text())
        except ValueError:warnings.append(path+': JSONC settings left intact');continue
        if d.get('git.path') != str(runtime/'bin/git'):continue
        if old is None:d.pop('git.path',None)
        else:d['git.path']=old
        p.write_text(json.dumps(d,indent=2)+'\n')
    state['enabled']=False;save_global(state)
    print('Global protection disabled; prior Git hooks and editor paths restored where unchanged.')
    for warning in warnings:print(warning,file=sys.stderr)
    print('The runtime is retained so existing shells and the reposhield command keep working. Reload terminals/editors.')

def protection_status():
    state=global_state()
    print('RepoShield '+VERSION)
    if not state or not state.get('enabled'):
        print('Global protection: OFF. Run reposhield enable.');return
    runtime=Path(state['runtime'])
    active=git('config','--global','--get','core.hooksPath',check=False,hooks=True).stdout.decode().strip()
    print('Global protection: '+('ON' if active==str(runtime/'hooks') else 'INCOMPLETE (global hooks changed)'))
    print('Git shim: '+str(runtime/'bin/git'))
    located=shutil.which('git')
    print('Terminal resolves git to: '+str(located))
    ready=bool(located and Path(located).resolve()==(runtime/'bin/git').resolve())
    print('Pull interception in this terminal: '+('ACTIVE' if ready else 'RELOAD REQUIRED (or configure your Git client)'))
    print('Existing per-repository hook overrides are handled automatically when pushing through the shim.')
    print('Coverage: current OS account; matching signatures; fast-forward pulls only; no guarantee against same-user bypass.')


def git_proxy(arguments):
    args = list(arguments)
    native_options = []
    while args and args[0].startswith('-'):
        flag = args.pop(0)
        if flag == '-C' and args:
            os.chdir(args.pop(0))
        elif flag in ('--no-pager', '--paginate', '--no-optional-locks', '--literal-pathspecs'):
            native_options.append(flag)
        elif flag == '-c' and args:
            value = args.pop(0)
            if value.split('=', 1)[0].lower() not in ('core.quotepath', 'color.ui', 'user.useconfigonly', 'diff.mnemonicprefix'):
                raise Blocked('Git configuration override is not permitted by the guard.')
            native_options.extend(['-c', value])
        elif flag in ('--version', '--help') and not args:
            return subprocess.call([GIT, flag])
        else:
            raise Blocked('Unsupported global Git option. The guarded shim accepts -C and --no-pager; configuration overrides are blocked.')
    if not args:
        return subprocess.call([GIT])
    command, rest = args[0], args[1:]
    state = global_state()
    if state and not state.get('enabled'):
        return subprocess.call([GIT] + native_options + args)
    if command == 'pull':
        unsupported = [a for a in rest if a.startswith('-') and a not in ('--ff-only', '--tags', '--no-tags')]
        if unsupported:
            raise Blocked('Unsupported pull option(s): ' + repr(unsupported) + '. Supported options: --ff-only, --tags, --no-tags. Retry: git pull --ff-only origin main (replace origin/main with your remote/branch).')
        include_tags = False
        for option in rest:
            if option in ('--tags', '--no-tags'):include_tags = option == '--tags'
        rest = [a for a in rest if a not in ('--ff-only', '--tags', '--no-tags')]
        if not rest:
            branch = git('symbolic-ref', '--quiet', '--short', 'HEAD').stdout.decode().strip()
            remote = git('config', '--get', 'branch.' + branch + '.remote').stdout.decode().strip()
            merge = git('config', '--get', 'branch.' + branch + '.merge').stdout.decode().strip()
            if not merge.startswith('refs/heads/'):
                raise Blocked('Configure an upstream branch or specify pull REMOTE BRANCH.')
            rest = [remote, merge[len('refs/heads/'):]]
        if len(rest) != 2:
            raise Blocked('Use git pull REMOTE BRANCH (one branch, fast-forward only).')
        guarded_pull(*rest, include_tags=include_tags)
        return 0
    if command == 'push':
        if '--no-verify' in rest:
            raise Blocked('Push bypass --no-verify is disabled by the guarded shim.')
        if repair_enabled():auto_repair_push(rest)
        if state and state.get('enabled'):
            import contextlib, io
            with contextlib.redirect_stdout(io.StringIO()):
                install(state['runtime'])
        common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.decode().strip())
        hooks = common / 'reposhield-hooks'
        active = git('config', '--get', 'core.hooksPath', check=False, hooks=True).stdout.decode().strip()
        if active != str(hooks) or not (hooks / 'pre-push').is_file():
            raise Blocked('Install RepoShield in this repository before pushing through the shim.')
        result = git(*args, hooks=True, check=False)
    else:
        # Other Git commands are not claimed as protected; retain native hooks for them.
        result = subprocess.run([GIT] + native_options + args, check=False)
        return result.returncode
    sys.stdout.buffer.write(result.stdout);sys.stderr.buffer.write(result.stderr)
    return result.returncode

def main():
    if len(sys.argv) == 1 or sys.argv[1] in ('enable','disable','status','--version','global-hook','repair'):
        try:
            action=sys.argv[1] if len(sys.argv)>1 else 'status'
            if action not in ('global-hook', 'repair') and len(sys.argv)>2:
                if sys.argv[2:] == ['--help']:
                    print('Usage: reposhield '+action);return 0
                raise Blocked('Unexpected arguments for '+action)
            if action=='repair':configure_repair(sys.argv[2:])
            elif action=='enable':enable_global()
            elif action=='disable':disable_global()
            elif action=='--version':print('RepoShield '+VERSION)
            elif action=='global-hook':
                if len(sys.argv)<3 or sys.argv[2] not in HOOK_NAMES:raise Blocked('Invalid hook name.')
                return global_hook(sys.argv[2],sys.argv[3:])
            else:protection_status()
            return 0
        except (Blocked,OSError,subprocess.TimeoutExpired,ValueError) as error:
            explain_error(error);return 1
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for name in ('enable','disable','status'):sub.add_parser(name)
    scan = sub.add_parser('scan');scan.add_argument('ref', nargs='?', default='HEAD')
    pull = sub.add_parser('pull');pull.add_argument('remote');pull.add_argument('branch')
    push = sub.add_parser('pre-push');push.add_argument('remote', nargs='?');push.add_argument('url', nargs='?')
    ins = sub.add_parser('install');ins.add_argument('--runtime', required=True)
    proxy = sub.add_parser('git-proxy');proxy.add_argument('git_args', nargs=argparse.REMAINDER)
    # REMAINDER still treats leading -C as an option, so parse proxy arguments ourselves.
    if len(sys.argv) > 1 and sys.argv[1] == 'git-proxy':
        try:
            return git_proxy(sys.argv[2:])
        except (Blocked, OSError, subprocess.TimeoutExpired, ValueError) as error:
            explain_error(error);return 1
    args = parser.parse_args()
    try:
        if args.action == 'scan':approve([revision(args.ref)]);print('RepoShield: revision passed targeted checks.')
        elif args.action == 'pull':guarded_pull(args.remote, args.branch)
        elif args.action == 'pre-push':pre_push(args.remote, args.url)
        elif args.action == 'install':install(args.runtime)
        return 0
    except (Blocked, OSError, subprocess.TimeoutExpired, ValueError) as error:
        explain_error(error)
        return 1

if __name__ == '__main__':
    sys.exit(main())
