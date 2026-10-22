"""Build docs/plan/plan.json from the plan files and check it.

    python3 scripts/plan/build.py
"""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base
import p1_foundations, p2_core_flow, p3_growth  # noqa: F401  (registering)
from base import EPICS, FEATURES, TASKS, ORDER, MS, PAGES

errors, warns = [], []
for k, t in TASKS.items():
    for d in t['deps']:
        if d not in TASKS:
            errors.append(f'{k}: unknown dep {d}')
        elif t['ms'] is not None and TASKS[d]['ms'] is not None and TASKS[d]['ms'] > t['ms'] and TASKS[d]['kind'] != 'decision':
            errors.append(f'{k} (ms {t["ms"]}) depends on later {d} (ms {TASKS[d]["ms"]})')
        elif TASKS[d]['kind'] == 'decision' and t['ms'] is not None and TASKS[d]['ms'] > t['ms']:
            warns.append(f'decision {d} (ms {TASKS[d]["ms"]}) blocks earlier {k} (ms {t["ms"]}): decide it early')
covered = defaultdict(list)
for k, t in TASKS.items():
    for c in t['pages']:
        covered[c].append(k)
missing = [c for c in PAGES if c not in covered]
if missing:
    errors.append(f'pages with no task: {missing}')

# topological order: milestone, then priority, then definition order
rank = {k: i for i, k in enumerate(ORDER)}
def keyf(k):
    t = TASKS[k]
    ms = -1 if t['kind'] == 'decision' and t['ms'] is not None and t['ms'] <= 1 else (t['ms'] if t['ms'] is not None else 99)
    return (ms, t['prio'], rank[k])
indeg = {k: 0 for k in TASKS}
rev = defaultdict(list)
for k, t in TASKS.items():
    for d in t['deps']:
        if d in TASKS:
            indeg[k] += 1; rev[d].append(k)
ready = sorted([k for k, v in indeg.items() if v == 0], key=keyf)
out = []
import heapq
heap = [(keyf(k), k) for k in ready]; heapq.heapify(heap)
while heap:
    _, k = heapq.heappop(heap); out.append(k)
    for n in rev[k]:
        indeg[n] -= 1
        if indeg[n] == 0:
            heapq.heappush(heap, (keyf(n), n))
if len(out) != len(TASKS):
    errors.append('dependency cycle among: ' + ', '.join(k for k in TASKS if k not in out))

if errors:
    print('\n'.join('ERROR ' + e for e in errors)); sys.exit(1)

def owner_txt(o):
    return {'william': 'William (@willimobro)', 'matt': 'Matt (@mlarsen084)', 'both': 'Matt and William'}.get(o, '')

def body(t, num=lambda k: None):
    ep, fe = EPICS[t['epic']], FEATURES[t['feature']]
    ref = lambda k: (f'#{num(k)}' if num(k) else f'`{k}`') + f' {TASKS[k]["title"]}'
    h = [f"**Milestone:** {MS[t['ms']] or 'Later'} · **Priority:** {t['prio'] if t['kind'] != 'idea' else '—'}"
         + (f" · **Size:** {t['size']}" if t['kind'] == 'task' else '') + f" · **Epic:** {ep['title']} › {fe['title']}"]
    if t['owner']:
        h.append(f"**Owner:** {owner_txt(t['owner'])}")
    if t['kind'] == 'decision':
        h += ['', '## The question', t['what']]
        if t['why']: h += ['', '## Why it matters', t['why']]
        h += ['', t['notes'], '', '## Decision', '_To be filled in by a founder._', '', '## When decided', *[f'- [ ] {a}' for a in t['ac']]]
    elif t['kind'] == 'idea':
        h += ['', '## The idea', t['what']]
        if t['why']: h += ['', '## Why', t['why']]
        if t['notes']: h += ['', f"_Source: {t['notes']}_"]
        h += ['', '> Not ready to build. A founder turns this into tasks when it’s time.']
    else:
        h += ['', '## What to build', t['what'] or '_See design reference._']
        if t['why']: h += ['', '## Why', t['why']]
        if t['ac']: h += ['', '## Acceptance criteria', *[f'- [ ] {a}' for a in t['ac']]]
        if t['ifs']: h += ['', '## What if…', *[f'- [ ] {a}' for a in t['ifs']]]
        if t['design']: h += ['', '## Design reference', *t['design']]
        if t['tests']: h += ['', '## Tests', *[f'- [ ] {a}' for a in t['tests']]]
        if t['done']: h += ['', '## Done when (every task)', *[f'- [ ] {a}' for a in t['done']]]
        if t['notes']: h += ['', '## Notes', t['notes']]
    if t['deps']:
        h += ['', '## Blocked by', *[f'- {ref(d)}' for d in t['deps']]]
    foot = {'task': '_Read AGENTS.md before starting. One task = one branch = one PR with `Closes #this`._',
            'decision': '_Founders only. Agents: don’t build anything that depends on this until it’s closed._',
            'idea': '_Ideas aren’t worked on until a founder moves them into a milestone._'}[t['kind']]
    h += ['', '---', foot + ' _Generated from `scripts/plan/`._']
    return '\n'.join(h)

plan = dict(
    milestones=[v for v in MS.values() if v],
    epics=list(EPICS.values()), features=list(FEATURES.values()),
    tasks=[dict(TASKS[k], order=i + 1, body=body(TASKS[k])) for i, k in enumerate(out)],
)
os.makedirs(os.path.join(os.path.dirname(__file__), '../../docs/plan'), exist_ok=True)
json.dump(plan, open(os.path.join(os.path.dirname(__file__), '../../docs/plan/plan.json'), 'w'), indent=1, ensure_ascii=False)
from collections import Counter
kinds = Counter(t['kind'] for t in TASKS.values())
print(f"epics {len(EPICS)} features {len(FEATURES)} " + ' '.join(f'{k} {v}' for k, v in kinds.items()))
print('by milestone', Counter(MS[t['ms']] or 'Later' for t in TASKS.values()))
print('pages covered', len(covered), '/', len(PAGES))
for w in warns: print('WARN', w)
