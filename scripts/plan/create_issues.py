"""Create the plan on GitHub: epics, features, tasks, decisions and ideas, with milestones, labels,
sub-issues and "blocked by" links. Safe to re-run: items already created (tracked in docs/plan/issues.json
and by a hidden marker in each body) are updated, not duplicated.

    python3 scripts/plan/build.py
    python3 scripts/plan/create_issues.py --dry-run
    python3 scripts/plan/create_issues.py
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REPO = 'trade-marketplace/main'
R = f'repos/{REPO}'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
PLAN = json.load(open(os.path.join(ROOT, 'docs/plan/plan.json')))
STATE_F = os.path.join(ROOT, 'docs/plan/issues.json')
STATE = json.load(open(STATE_F)) if os.path.exists(STATE_F) else {}
DRY = '--dry-run' in sys.argv
TYPE_OK = {'v': True}


def save():
    if DRY:
        return
    json.dump(STATE, open(STATE_F, 'w'), indent=1, sort_keys=True)


def api(method, path, payload=None, ok=(200, 201, 204)):
    if DRY:
        return {'number': 0, 'id': 0}
    args = ['gh', 'api', '-X', method, path, '-H', 'Accept: application/vnd.github+json', '-i']
    inp = None
    if payload is not None:
        args += ['--input', '-']; inp = json.dumps(payload)
    for attempt in range(6):
        r = subprocess.run(args, input=inp, capture_output=True, text=True)
        head, _, body = r.stdout.partition('\r\n\r\n') if '\r\n\r\n' in r.stdout else r.stdout.partition('\n\n')
        status = int(head.split()[1]) if head.startswith('HTTP') else 0
        if status in ok:
            time.sleep(0.7)
            return json.loads(body) if body.strip() else {}
        if status in (403, 429) and ('rate limit' in body.lower() or 'secondary' in body.lower()):
            wait = 60 * (attempt + 1); print(f'  rate limited, waiting {wait}s'); time.sleep(wait); continue
        if status >= 500:
            time.sleep(5 * (attempt + 1)); continue
        raise RuntimeError(f'{method} {path} -> {status}: {body[:500]} {r.stderr[:300]}')
    raise RuntimeError(f'{method} {path} gave up')


MS = {}
if not DRY:
    for m in api('GET', f'{R}/milestones?state=all&per_page=100'):
        MS[m['title']] = m['number']


def marker(key):
    return f'\n\n<!-- plan:{key} -->'


def upsert(key, title, body, labels, ms=None, itype=None):
    payload = dict(title=title, body=body + marker(key), labels=labels)
    if ms:
        payload['milestone'] = MS.get(ms)
    if itype and TYPE_OK['v']:
        payload['type'] = itype
    if key in STATE:
        api('PATCH', f"{R}/issues/{STATE[key]['number']}", payload)
        return STATE[key]
    try:
        res = api('POST', f'{R}/issues', payload)
    except RuntimeError as e:
        if 'type' in payload and ('type' in str(e).lower()):
            print('  issue types not available; continuing without them'); TYPE_OK['v'] = False
            payload.pop('type'); res = api('POST', f'{R}/issues', payload)
        else:
            raise
    STATE[key] = dict(number=res['number'], id=res['id']); save()
    return STATE[key]


def num(k):
    return STATE.get(k, {}).get('number')


def main():
    import build  # noqa: F401  re-validates the plan
    from build import body as task_body
    from base import TASKS
    epics, feats, tasks = PLAN['epics'], PLAN['features'], PLAN['tasks']
    print(f'{len(epics)} epics, {len(feats)} features, {len(tasks)} items{" (dry run)" if DRY else ""}')
    ms_of_epic = {e['key']: e['ms'] for e in epics}
    msname = {i: n for i, n in enumerate(PLAN['milestones'])}
    for e in epics:
        upsert('epic:' + e['key'], e['title'], f"{e['what']}\n\nThe features and tasks for this epic are its sub-issues; the progress bar shows how far along it is.",
               ['epic', f"area:{e['area']}"], msname.get(e['ms']), 'Feature')
        print('epic', e['title'], num('epic:' + e['key']))
    for f in feats:
        upsert('feature:' + f['key'], f['title'], (f['what'] + '\n\n' if f['what'] else '') + 'Tasks for this feature are its sub-issues.',
               ['feature', f"area:{f['area']}"], msname.get(ms_of_epic[f['epic']]), 'Feature')
    print('features done')
    # first pass: create everything (bodies reference keys); second pass: rewrite bodies with numbers
    itype = {'task': 'Task', 'decision': 'Task', 'idea': None}
    for t in tasks:
        upsert(t['key'], t['title'], t['body'], t['labels'], msname.get(t['ms']), itype[t['kind']])
        if t['order'] % 20 == 0:
            print(' created', t['order'])
    print('items created')
    for t in tasks:
        b = task_body(TASKS[t['key']], num)
        api('PATCH', f"{R}/issues/{num(t['key'])}", dict(body=b + marker(t['key'])))
    print('bodies linked')
    links = STATE.setdefault('_links', [])
    def link(parent, child):
        tag = f'sub:{parent}>{child}'
        if tag in links: return
        api('POST', f"{R}/issues/{num(parent)}/sub_issues", dict(sub_issue_id=STATE[child]['id']))
        links.append(tag); save()
    for f in feats:
        link('epic:' + f['epic'], 'feature:' + f['key'])
    for t in tasks:
        link('feature:' + t['feature'], t['key'])
    print('sub-issues linked')
    for t in tasks:
        for d in t['deps']:
            tag = f'dep:{t["key"]}<{d}'
            if tag in links: continue
            api('POST', f"{R}/issues/{num(t['key'])}/dependencies/blocked_by", dict(issue_id=STATE[d]['id']))
            links.append(tag); save()
    print('dependencies linked')
    for t in tasks:
        if t['kind'] == 'decision' and t.get('owner') in ('william', 'matt', 'both'):
            who = {'william': ['willimobro'], 'matt': ['mlarsen084'], 'both': ['mlarsen084', 'willimobro']}[t['owner']]
            try:
                api('POST', f"{R}/issues/{num(t['key'])}/assignees", dict(assignees=who))
            except RuntimeError as e:
                print('  could not assign', t['key'], str(e)[:120])
    print('done')


if __name__ == '__main__':
    main()
