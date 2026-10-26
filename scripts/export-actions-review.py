#!/usr/bin/env python3
"""Export GitHub Actions logs/metadata for file-based GPT review (stdlib + gh)."""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', default='Astrea-296111/cue')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--decrypted-results', type=Path,
                        help='Optional existing plaintext results; only report.json is copied, never keys.')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        parser.error('Invalid repository')
    if not 1 <= args.workers <= 6:
        parser.error('workers must be 1..6')
    root = Path(args.output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)

    def gh(endpoint):
        result = subprocess.run(['gh', 'api', endpoint], capture_output=True, timeout=180)
        if result.returncode:
            # Do not reproduce credential-bearing command environments/errors.
            raise RuntimeError('GitHub API request failed: ' + endpoint.split('?')[0])
        return result.stdout

    def api(endpoint):
        return json.loads(gh(endpoint))

    def scrub(text):
        text = re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{28,})\b',
                      '[REDACTED-CREDENTIAL]', text)
        return text

    def redact(value):
        if isinstance(value, dict):
            secrets = {'apikey', 'api_key', 'authorization', 'access_token',
                       'refresh_token', 'privatekey', 'private_key', 'password'}
            return {key: '[REDACTED-CREDENTIAL]' if key.lower() in secrets else redact(item)
                    for key, item in value.items()}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value

    def save(relative, value):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(scrub(json.dumps(redact(value), ensure_ascii=False, indent=2)) + '\n', encoding='utf-8')

    runs = []
    page = 1
    while True:
        data = api('repos/' + args.repository + '/actions/runs?per_page=100&page=' + str(page))
        batch = data['workflow_runs']
        runs.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    unique = {str(run['id']): run for run in runs}
    print('Exporting ' + str(len(unique)) + ' unique Actions runs.', flush=True)

    def export(run):
        run_id = str(run['id'])
        prefix = 'runs/' + run_id
        save(prefix + '/run.json', run)
        row = {'runId':run_id, 'name':run['name'], 'workflowPath':run['path'],
               'applicationCommit':run['head_sha'], 'status':run['status'],
               'conclusion':run['conclusion'], 'url':run['html_url'],
               'createdAt':run['created_at'], 'metadata':prefix+'/run.json',
               'logs':None, 'artifacts':[], 'plaintextEvaluationReport':None,
               'recoveryErrors':[]}
        try:
            raw = gh('repos/' + args.repository + '/actions/runs/' + run_id + '/logs')
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                names = [name for name in archive.namelist() if name.endswith('.txt')]
                # GitHub includes a complete top-level log per job and duplicate
                # individual steps. Prefer the complete logs without doubling text.
                complete = [name for name in names if '/' not in name.strip('/')]
                parts = []
                for name in sorted(complete or names):
                    parts.append('===== ' + name + ' =====\n' + archive.read(name).decode('utf-8', 'replace'))
            target = root / prefix / 'logs.txt'
            target.write_text(scrub('\n\n'.join(parts)), encoding='utf-8')
            row['logs'] = prefix + '/logs.txt'
        except Exception as error:
            row['recoveryErrors'].append({'kind':'logs-unavailable', 'type':type(error).__name__})
        try:
            artifacts = api('repos/' + args.repository + '/actions/runs/' + run_id + '/artifacts?per_page=100')['artifacts']
            save(prefix + '/artifacts.json', artifacts)
            for artifact in artifacts:
                entry = {'id':artifact['id'], 'name':artifact['name'],
                         'bytes':artifact['size_in_bytes'], 'expired':artifact['expired'],
                         'downloadedFiles':[], 'contentState':'inventory-only'}
                row['artifacts'].append(entry)
                if artifact['expired'] or not artifact['name'].startswith(('private-live-', 'private-session-')):
                    continue
                try:
                    data = gh('repos/' + args.repository + '/actions/artifacts/' + str(artifact['id']) + '/zip')
                    with zipfile.ZipFile(io.BytesIO(data)) as archive:
                        for name in archive.namelist():
                            leaf = Path(name).name
                            readable = name.replace('\\', '/').startswith('readable/')
                            if leaf not in ('summary.json', 'session.json', 'report.encrypted.json') and not (readable and leaf.endswith(('.json','.md'))):
                                continue
                            relative = prefix + '/' + leaf
                            if readable:
                                target = root / prefix / 'readable' / leaf
                                target.parent.mkdir(parents=True, exist_ok=True)
                                content = archive.read(name).decode('utf-8')
                                if leaf.endswith('.json'):
                                    save(prefix+'/readable/'+leaf, json.loads(content))
                                else:
                                    target.write_text(scrub(content), encoding='utf-8')
                                entry['downloadedFiles'].append(prefix+'/readable/'+leaf)
                                if leaf == 'report.json':
                                    row['plaintextEvaluationReport'] = prefix+'/readable/'+leaf
                                continue
                            value = json.loads(archive.read(name))
                            if leaf == 'report.encrypted.json':
                                relative = 'encrypted/' + run_id + '/' + leaf
                            save(relative, value)
                            entry['downloadedFiles'].append(relative)
                    entry['contentState'] = 'encrypted-report-and-public-metadata'
                except Exception as error:
                    entry['contentState'] = 'download-failed'
                    row['recoveryErrors'].append({'kind':'artifact-unavailable', 'artifactId':artifact['id'], 'type':type(error).__name__})
        except Exception as error:
            row['recoveryErrors'].append({'kind':'artifact-inventory-unavailable', 'type':type(error).__name__})
        return row

    index = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(export, unique.values()):
            index.append(row)
            if len(index) % 20 == 0:
                print('Exported ' + str(len(index)) + '/' + str(len(unique)), flush=True)

    plaintext = []
    if args.decrypted_results:
        # Copy only valid report data. Never copy whole result directories,
        # local-key.json, input envelopes, runner private keys or API settings.
        for file in sorted(args.decrypted_results.rglob('report.json')):
            if file.is_symlink() or file.stat().st_size > 256*1024*1024:
                continue
            value = json.loads(file.read_text(encoding='utf-8'))
            if not isinstance(value, dict) or not isinstance(value.get('providers'), list) or 'summary' not in value:
                continue
            payload = (scrub(json.dumps(redact(value), ensure_ascii=False, indent=2))+'\n').encode()
            digest = hashlib.sha256(payload).hexdigest()
            relative = 'reports/' + digest[:16] + '/report.json'
            save(relative, value)
            plaintext.append({'path':relative, 'sha256':digest, 'applicationCommit':value.get('application',{}).get('commit')})
    result = {'schemaVersion':1, 'repository':args.repository,
              'runCount':len(index), 'logsRecovered':sum(bool(row['logs']) for row in index),
              'plaintextReportCount':len(plaintext)+sum(bool(row['plaintextEvaluationReport']) for row in index), 'plaintextReports':plaintext,
              'encryptedReportCount':len(list((root/'encrypted').rglob('report.encrypted.json'))) if (root/'encrypted').exists() else 0,
              'limits':['Actions logs do not contain the private evaluation answers.',
                        'Encrypted reports require the original local-key.json; exporting them does not decrypt them.',
                        'Non-evaluation binaries are inventoried, not copied.',
                        'Expired or unavailable logs/artifacts remain explicitly listed.'],
              'runs':index}
    save('run-index.json', result)
    print(json.dumps({k:result[k] for k in ['runCount','logsRecovered','plaintextReportCount','encryptedReportCount']}), flush=True)


if __name__ == '__main__':
    main()
