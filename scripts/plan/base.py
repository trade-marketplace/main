"""Plan building blocks. Every issue in the plan is created through E(), F() or T().

Run `python3 scripts/plan/build.py` to write docs/plan/plan.json (and check it).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SITEMAP = json.load(open(os.path.join(HERE, '../../docs/design/sitemap.json')))
PAGES = {p['code']: p for p in SITEMAP['pages']}
MOTION = {m['id']: m for m in SITEMAP['motion']}

EPICS, FEATURES, TASKS = {}, {}, {}
ORDER = []  # global creation order of task keys

MS = {0: '0 · Foundations', 1: '1 · Core job flow', 2: '2 · Quote bounties & AI pricing', 3: '3 · Launch: Invercargill',
      4: '4 · Crews', 5: '5 · Verified quoters', None: None}


def E(key, title, area, what, ms=None):
    EPICS[key] = dict(key=key, kind='epic', title=title, area=area, what=what, ms=ms)


_cur = {}


def F(key, epic, title, what=''):
    FEATURES[key] = dict(key=key, kind='feature', epic=epic, title=title, what=what, area=EPICS[epic]['area'])
    _cur['f'] = key


UI_DONE = [
    'Matches the mockup at 1440 px (desktop) and 390 px (phone) where one exists; anything not designed follows the closest designed page',
    'Every state listed above is built and reachable (use seed data or a query flag so reviewers can see each one)',
    'Works at 320 / 390 / 768 / 1024 / 1440 px with no sideways scroll',
    'Keyboard-only run-through works; focus is visible; axe shows no violations',
    'Tokens and kit components only (no hex); correct mode colours',
    'Screenshots (1440 + 390, every state) in the PR next to the mockup',
]
CODE_DONE = [
    'Unit tests cover the main path and every “What if…” above',
    'lint, typecheck, test and build all pass',
]


def T(key, title, ms, prio='P1', size='M', what='', why='', ac=(), ifs=(), tests=(), notes='', deps=(), labels=(),
      pages=(), mock=None, motion=(), feature=None, kind='task', owner=None, ui=None):
    """A task. `pages` are sitemap codes; their route, states and design notes are pulled in automatically."""
    f = feature or _cur['f']
    ep = FEATURES[f]['epic']
    pg = [PAGES[c] for c in pages]
    if ui is None:
        ui = bool(pg)
    if pg and not what:
        what = ' '.join(f"**{p['name']}** (`{p['route']}`): {p['what']}." for p in pg)
    design = []
    for p in pg:
        d = f"- **{p['code']} {p['name']}** · route `{p['route']}` · {p['priority']} · mode `{p['mode']}`"
        if p['mockup_key']:
            d += f" · mockup `{p['mockup_key']}` (“{p['mockup']}”) in `docs/design/pages.html` / `screens.html`"
        else:
            d += ' · no mockup: follow the closest designed page and the rules in WEBAPP_SPEC.md'
        d += f"\n  - States: {p['states']}"
        for i, n in enumerate(p['notes'], 1):
            d += f"\n  - Design note {i}: {n}"
        design.append(d)
    mo = list(motion) + [m for p in pg for m in p['motion'] if m not in motion]
    if mock:
        design.append(f'- Mockup `{mock}` in `docs/design/pages.html` / `screens.html`')
    if mo:
        design.append('- Animations: ' + '; '.join(f"**{m}** {MOTION[m]['name']} ({MOTION[m]['timing']})" for m in mo))
    states = []
    for p in pg:
        if p['states'] and p['states'] not in ('—', 'Default'):
            states.append(f"States from the spec: {p['states']}")
    lab = set(labels)
    lab.add(prio); lab.add(f'size:{size}'); lab.add(f"area:{EPICS[ep]['area']}")
    for p in pg:
        lab.add('mode:' + p['mode'])
    if ui:
        lab.add('ui')
    if kind == 'decision':
        lab |= {'decision', 'human-only'}; lab.discard(f'size:{size}')
    if kind == 'idea':
        lab.add('idea'); lab.discard(f'size:{size}'); lab.discard(prio)
    done = []
    if kind == 'task':
        done = (UI_DONE if ui else []) + ([] if 'human-only' in lab else CODE_DONE)
    if key in TASKS:
        raise SystemExit(f'duplicate key {key}')
    TASKS[key] = dict(key=key, kind=kind, title=title, feature=f, epic=ep, ms=ms, prio=prio, size=size,
                      labels=sorted(lab), what=what.strip(), why=why.strip(), ac=list(ac) + states, ifs=list(ifs),
                      design=design, tests=list(tests), notes=notes.strip(), deps=list(deps), done=done, owner=owner,
                      pages=list(pages))
    ORDER.append(key)
    return key


def D(key, title, question, options, blocks_note='', owner='both', ms=0, prio='P1', why=''):
    """A founder decision. Tasks that need the answer list it in deps."""
    return T(key, title, ms, prio=prio, kind='decision', what=question, why=why,
             ac=['Answer written in the “Decision” section of this issue', 'Added to DECISIONS.md', 'Blocked tasks updated if the answer changes them'],
             ifs=[], notes='**Options**\n' + '\n'.join(f'- {o}' for o in options) + (f'\n\n{blocks_note}' if blocks_note else ''),
             owner=owner)


def I(key, title, what, why='', source='', pages=()):
    """An idea for later. Not worked on until a founder turns it into a task."""
    return T(key, title, None, kind='idea', what=what, why=why, notes=source, pages=pages, ui=False)
